import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { ChatsService } from '../chats/chats.service';
import { MessagesService } from '../chats/messages.service';
import { toDecisionDto } from '../chats/mappers';
import type { AnswerDecisionDto, CreateDecisionDto } from './dto';

const WITH_RESPONSES = { responses: { orderBy: { at: 'asc' } } } as const;

@Injectable()
export class DecisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly chats: ChatsService,
    private readonly messages: MessagesService,
  ) {}

  /** A decision made from a chat message, to be confirmed by the chosen members of that chat. */
  async createFromMessage(actor: User, chatId: string, messageId: string, dto: CreateDecisionDto, ip?: string) {
    const { chat } = await this.chats.requireMember(chatId, actor.id);
    ChatsService.assertWritable(chat);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, chatId }, include: { decision: { select: { id: true } } } });
    if (!message) throw new NotFoundException('MESSAGE_NOT_FOUND');
    if (message.deletedAt) throw new BadRequestException('MESSAGE_DELETED');
    if (message.decision) throw new ConflictException('DECISION_EXISTS');
    // the author does not confirm their own decision
    const addresseeIds = [...new Set(dto.addresseeIds)].filter((id) => id !== actor.id);
    if (addresseeIds.length === 0) throw new BadRequestException('ADDRESSEES_REQUIRED');
    const members = chat.members.map((m) => m.userId);
    if (addresseeIds.some((id) => !members.includes(id))) throw new BadRequestException('ADDRESSEE_NOT_IN_CHAT');
    const project = await this.prisma.project.findUnique({ where: { chatId }, select: { id: true } });

    let decision;
    try {
      decision = await this.prisma.decision.create({
        data: { text: dto.text.trim(), addresseeIds, createdById: actor.id, sourceChatId: chatId, sourceMessageId: messageId, projectId: project?.id ?? null },
        include: WITH_RESPONSES,
      });
    } catch (e) {
      // two people pressed the button at the same moment: the unique link to the message decided
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('DECISION_EXISTS');
      throw e;
    }
    await this.audit.log({ actorId: actor.id, action: 'decision.created', entityType: 'Decision', entityId: decision.id, data: { chatId, messageId, addresseeIds, text: decision.text }, ip });
    await this.messages.broadcastUpdate(messageId);
    return toDecisionDto(decision);
  }

  /** An addressee agrees, objects (with a comment) or acknowledges. Answering again replaces the earlier answer. */
  async answer(actor: User, decisionId: string, dto: AnswerDecisionDto, ip?: string) {
    const d = await this.prisma.decision.findUnique({ where: { id: decisionId }, include: { ...WITH_RESPONSES, sourceMessage: { select: { deletedAt: true } } } });
    // not a member of the chat: the decision does not exist for them
    const member = d ? await this.prisma.chatMember.findUnique({ where: { chatId_userId: { chatId: d.sourceChatId, userId: actor.id } } }) : null;
    if (!d || !member) throw new NotFoundException('DECISION_NOT_FOUND');
    if (!d.addresseeIds.includes(actor.id)) throw new ForbiddenException('NOT_ADDRESSEE');
    if (d.sourceMessage?.deletedAt) throw new BadRequestException('MESSAGE_DELETED');
    const comment = dto.comment?.trim() || null;
    if (dto.answer === 'OBJECT' && !comment) throw new BadRequestException('COMMENT_REQUIRED');

    const previous = d.responses.find((r) => r.userId === actor.id);
    await this.prisma.decisionResponse.upsert({
      where: { decisionId_userId: { decisionId, userId: actor.id } },
      update: { answer: dto.answer, comment, at: new Date() },
      create: { decisionId, userId: actor.id, answer: dto.answer, comment },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'decision.answered',
      entityType: 'Decision',
      entityId: decisionId,
      data: { answer: dto.answer, comment, previousAnswer: previous?.answer ?? null, previousComment: previous?.comment ?? null },
      ip,
    });
    if (d.sourceMessageId) await this.messages.broadcastUpdate(d.sourceMessageId);
    const fresh = await this.prisma.decision.findUniqueOrThrow({ where: { id: decisionId }, include: WITH_RESPONSES });
    return toDecisionDto(fresh);
  }

  /** Decisions waiting for my answer, oldest first. */
  async pendingFor(actor: User) {
    const rows = await this.prisma.decision.findMany({
      where: { addresseeIds: { has: actor.id }, responses: { none: { userId: actor.id } }, sourceMessage: { deletedAt: null }, sourceChat: { members: { some: { userId: actor.id } } } },
      include: WITH_RESPONSES,
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return rows.map(toDecisionDto);
  }
}
