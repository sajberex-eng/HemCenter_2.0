import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MAX_PINS_PER_CHAT, type MessageDto } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ChatsService } from './chats.service';
import { REPLY_INCLUDE, toMessageDto } from './mappers';

@Injectable()
export class PinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly chats: ChatsService,
  ) {}

  /** Newest pin first. */
  async list(chatId: string, userId: string): Promise<MessageDto[]> {
    await this.chats.requireMember(chatId, userId);
    const pins = await this.prisma.pin.findMany({ where: { chatId, message: { deletedAt: null } }, orderBy: { pinnedAt: 'desc' }, include: { message: { include: REPLY_INCLUDE } } });
    return pins.map((p) => toMessageDto(p.message));
  }

  /** Direct chats: either person. Groups: only the owner, so the pinned bar does not turn into a free-for-all. */
  private async requireMayPin(chatId: string, userId: string) {
    const { chat, me } = await this.chats.requireMember(chatId, userId);
    ChatsService.assertWritable(chat);
    if (chat.type === 'GROUP' && me.role !== 'OWNER') throw new ForbiddenException('FORBIDDEN');
    return chat;
  }

  async pin(chatId: string, userId: string, messageId: string, ip?: string) {
    const chat = await this.requireMayPin(chatId, userId);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, chatId, deletedAt: null } });
    if (!message) throw new NotFoundException('MESSAGE_NOT_FOUND');
    const existing = await this.prisma.pin.count({ where: { chatId } });
    const already = await this.prisma.pin.findUnique({ where: { chatId_messageId: { chatId, messageId } } });
    if (!already && existing >= MAX_PINS_PER_CHAT) throw new BadRequestException('TOO_MANY_PINS');
    if (!already) {
      await this.prisma.pin.create({ data: { chatId, messageId, pinnedById: userId } });
      await this.audit.log({ actorId: userId, action: 'message.pinned', entityType: 'Message', entityId: messageId, data: { chatId }, ip });
      this.realtime.emit(chat.members.map((m) => m.userId), 'chat:pins', { chatId });
    }
    return this.list(chatId, userId);
  }

  async unpin(chatId: string, userId: string, messageId: string, ip?: string) {
    const chat = await this.requireMayPin(chatId, userId);
    const res = await this.prisma.pin.deleteMany({ where: { chatId, messageId } });
    if (res.count) {
      await this.audit.log({ actorId: userId, action: 'message.unpinned', entityType: 'Message', entityId: messageId, data: { chatId }, ip });
      this.realtime.emit(chat.members.map((m) => m.userId), 'chat:pins', { chatId });
    }
  }
}
