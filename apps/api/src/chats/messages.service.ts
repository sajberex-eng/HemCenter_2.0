import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AROUND_WINDOW, MESSAGES_PAGE_SIZE, type MessageDto } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ChatsService } from './chats.service';
import { FilesService } from '../files/files.service';
import { PushService } from '../push/push.service';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../files/file-rules';
import { REPLY_INCLUDE, toMessageDto } from './mappers';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly chats: ChatsService,
    private readonly files: FilesService,
    private readonly push: PushService,
  ) {}

  /**
   * Newest first by number; pass the smallest seq you already have as `before` to load older ones.
   * With `around` (a search hit) returns a window of messages on both sides of that number instead, and with
   * `after` the next page of newer messages (to scroll forward from such a window).
   */
  async list(chatId: string, userId: string, opts: { before?: number; after?: number; around?: number; limit?: number } = {}) {
    const { chat } = await this.chats.requireMember(chatId, userId);
    if (opts.around !== undefined) {
      const lower = Math.max(opts.around - AROUND_WINDOW, 1);
      const upper = opts.around + AROUND_WINDOW;
      const rows = await this.prisma.message.findMany({ where: { chatId, seq: { gte: lower, lte: upper } }, orderBy: { seq: 'asc' }, include: REPLY_INCLUDE });
      return { messages: rows.map(toMessageDto), hasMore: lower > 1, hasNewer: upper < chat.lastSeq };
    }
    const take = Math.min(Math.max(opts.limit ?? MESSAGES_PAGE_SIZE, 1), 100);
    if (opts.after !== undefined) {
      // moving forward from a hit: the next page of newer messages, oldest first
      const newer = await this.prisma.message.findMany({ where: { chatId, seq: { gt: opts.after } }, orderBy: { seq: 'asc' }, take: take + 1, include: REPLY_INCLUDE });
      const hasNewer = newer.length > take;
      return { messages: newer.slice(0, take).map(toMessageDto), hasMore: opts.after > 0, hasNewer };
    }
    const rows = await this.prisma.message.findMany({
      where: { chatId, ...(opts.before ? { seq: { lt: opts.before } } : {}) },
      orderBy: { seq: 'desc' },
      take: take + 1,
      include: REPLY_INCLUDE,
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take).reverse(); // oldest first, ready to render
    return { messages: page.map(toMessageDto), hasMore, hasNewer: false };
  }

  private async validateMentions(memberIds: string[], mentionIds: string[] | undefined) {
    const unique = [...new Set(mentionIds ?? [])];
    if (unique.some((id) => !memberIds.includes(id))) throw new BadRequestException('INVALID_MENTION');
    return unique;
  }

  async create(chatId: string, userId: string, input: { body?: string; replyToId?: string; mentionIds?: string[]; attachmentIds?: string[] }): Promise<MessageDto> {
    const { chat } = await this.chats.requireMember(chatId, userId);
    ChatsService.assertWritable(chat);
    const body = (input.body ?? '').trim();
    const attachmentIds = [...new Set(input.attachmentIds ?? [])];
    if (!body && attachmentIds.length === 0) throw new BadRequestException('EMPTY_MESSAGE');
    if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new BadRequestException('TOO_MANY_ATTACHMENTS');
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
      });
      if (attachmentIds.length) {
        // Only the sender's own, still unsent files of this very chat can be attached. The conditional update
        // also settles races: if two messages claim one file, one of them matches fewer rows and rolls back.
        const claimed = await tx.attachment.updateMany({
          where: { id: { in: attachmentIds }, uploaderId: userId, chatId, messageId: null, deletedAt: null },
          data: { messageId: created.id },
        });
        if (claimed.count !== attachmentIds.length) throw new BadRequestException('ATTACHMENT_INVALID');
      }
      // Sending must NOT move the author's read pointer: they may have written from another device or a
      // notification without opening the chat, and a false "read" receipt would mislead everyone else.
      // Own messages never count as unread anyway (the unread query excludes the author).
      return tx.message.findUniqueOrThrow({ where: { id: created.id }, include: REPLY_INCLUDE });
    });

    const dto = toMessageDto(message);
    this.realtime.emit(memberIds, 'message:new', dto);
    // after the response is ready: push must never slow down or break sending
    void this.push.notifyNewMessage(dto, chat.members.map((m) => ({ userId: m.userId, notifyMode: m.notifyMode })));
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
    ChatsService.assertWritable(chat);
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
    ChatsService.assertWritable(chat);
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { body: null, mentionIds: [], deletedAt: new Date() },
      include: REPLY_INCLUDE,
    });
    // a deleted message must not stay pinned
    if ((await this.prisma.pin.deleteMany({ where: { messageId } })).count) this.realtime.emit(chat.members.map((m) => m.userId), 'chat:pins', { chatId });
    const removedFiles = await this.files.removeForMessage(messageId);
    await this.audit.log({ actorId: userId, action: 'message.deleted', entityType: 'Message', entityId: messageId, data: { chatId, previousBody: message.body, removedFiles }, ip });
    const dto = toMessageDto(updated);
    this.realtime.emit(chat.members.map((m) => m.userId), 'message:deleted', dto);
    return dto;
  }
}
