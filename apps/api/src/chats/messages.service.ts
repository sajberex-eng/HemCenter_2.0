import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MESSAGES_PAGE_SIZE, type MessageDto } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ChatsService } from './chats.service';
import { REPLY_INCLUDE, toMessageDto } from './mappers';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly chats: ChatsService,
  ) {}

  /** Newest first by number; pass the smallest seq you already have as `before` to load older ones. */
  async list(chatId: string, userId: string, before?: number, limit = MESSAGES_PAGE_SIZE) {
    await this.chats.requireMember(chatId, userId);
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.prisma.message.findMany({
      where: { chatId, ...(before ? { seq: { lt: before } } : {}) },
      orderBy: { seq: 'desc' },
      take: take + 1,
      include: REPLY_INCLUDE,
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take).reverse(); // oldest first, ready to render
    return { messages: page.map(toMessageDto), hasMore };
  }

  private async validateMentions(memberIds: string[], mentionIds: string[] | undefined) {
    const unique = [...new Set(mentionIds ?? [])];
    if (unique.some((id) => !memberIds.includes(id))) throw new BadRequestException('INVALID_MENTION');
    return unique;
  }

  async create(chatId: string, userId: string, input: { body: string; replyToId?: string; mentionIds?: string[] }): Promise<MessageDto> {
    const { chat } = await this.chats.requireMember(chatId, userId);
    const body = input.body.trim();
    if (!body) throw new BadRequestException('EMPTY_MESSAGE');
    const memberIds = chat.members.map((m) => m.userId);
    const mentionIds = await this.validateMentions(memberIds, input.mentionIds);
    if (input.replyToId) {
      const target = await this.prisma.message.findFirst({ where: { id: input.replyToId, chatId, deletedAt: null } });
      if (!target) throw new BadRequestException('REPLY_NOT_FOUND');
    }

    // Bumping lastSeq locks the chat row, so concurrent senders get distinct, gap-free numbers.
    const message = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.chat.update({ where: { id: chatId }, data: { lastSeq: { increment: 1 }, lastMessageAt: new Date() } });
      const created = await tx.message.create({
        data: { chatId, seq: updated.lastSeq, authorId: userId, body, replyToId: input.replyToId, mentionIds },
        include: REPLY_INCLUDE,
      });
      // Sending must NOT move the author's read pointer: they may have written from another device or a
      // notification without opening the chat, and a false "read" receipt would mislead everyone else.
      // Own messages never count as unread anyway (the unread query excludes the author).
      return created;
    });

    const dto = toMessageDto(message);
    this.realtime.emit(memberIds, 'message:new', dto);
    return dto;
  }

  private async requireAuthored(chatId: string, messageId: string, userId: string) {
    await this.chats.requireMember(chatId, userId);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, chatId }, include: REPLY_INCLUDE });
    if (!message) throw new NotFoundException('MESSAGE_NOT_FOUND');
    if (message.authorId !== userId) throw new ForbiddenException('FORBIDDEN');
    if (message.deletedAt) throw new BadRequestException('MESSAGE_DELETED');
    return message;
  }

  async edit(chatId: string, messageId: string, userId: string, input: { body: string; mentionIds?: string[] }, ip?: string) {
    const message = await this.requireAuthored(chatId, messageId, userId);
    const { chat } = await this.chats.requireMember(chatId, userId);
    const body = input.body.trim();
    if (!body) throw new BadRequestException('EMPTY_MESSAGE');
    const mentionIds = await this.validateMentions(chat.members.map((m) => m.userId), input.mentionIds);
    if (body === message.body) return toMessageDto(message);
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { body, mentionIds, editedAt: new Date() },
      include: REPLY_INCLUDE,
    });
    // the previous text stays recoverable by an administrator
    await this.audit.log({ actorId: userId, action: 'message.edited', entityType: 'Message', entityId: messageId, data: { chatId, previousBody: message.body }, ip });
    const dto = toMessageDto(updated);
    this.realtime.emit(chat.members.map((m) => m.userId), 'message:updated', dto);
    return dto;
  }

  async remove(chatId: string, messageId: string, userId: string, ip?: string) {
    const message = await this.requireAuthored(chatId, messageId, userId);
    const { chat } = await this.chats.requireMember(chatId, userId);
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { body: null, mentionIds: [], deletedAt: new Date() },
      include: REPLY_INCLUDE,
    });
    await this.audit.log({ actorId: userId, action: 'message.deleted', entityType: 'Message', entityId: messageId, data: { chatId, previousBody: message.body }, ip });
    const dto = toMessageDto(updated);
    this.realtime.emit(chat.members.map((m) => m.userId), 'message:deleted', dto);
    return dto;
  }
}
