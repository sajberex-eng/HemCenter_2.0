import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GROUP_MAX_MEMBERS, type ChatDto, type NotifyMode } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { REPLY_INCLUDE, toMessageDto } from './mappers';

const withMembers = { members: true } as const;

@Injectable()
export class ChatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Returns the chat only to its members. Outsiders get "not found" rather than "forbidden",
   * so the existence of other people's chats is not revealed.
   */
  async requireMember(chatId: string, userId: string) {
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId }, include: withMembers });
    const me = chat?.members.find((m) => m.userId === userId);
    if (!chat || !me) throw new NotFoundException('CHAT_NOT_FOUND');
    return { chat, me };
  }

  /** Imported history cannot be changed: no new messages, edits, deletions, pins or files. */
  static assertWritable(chat: { type: string }) {
    if (chat.type === 'ARCHIVE') throw new BadRequestException('CHAT_READ_ONLY');
  }

  private async assertActiveUsers(ids: string[]) {
    const found = await this.prisma.user.count({ where: { id: { in: ids }, isActive: true } });
    if (found !== new Set(ids).size) throw new BadRequestException('USER_NOT_FOUND');
  }

  private memberIds(chat: { members: { userId: string }[] }) {
    return chat.members.map((m) => m.userId);
  }

  async list(userId: string): Promise<ChatDto[]> {
    const chats = await this.prisma.chat.findMany({
      where: { members: { some: { userId } } },
      include: withMembers,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    if (chats.length === 0) return [];

    const unread = await this.prisma.$queryRaw<{ chatId: string; n: number }[]>`
      SELECT m."chatId", COUNT(*)::int AS n
      FROM "Message" m
      JOIN "ChatMember" cm ON cm."chatId" = m."chatId" AND cm."userId" = ${userId}
      WHERE m.seq > cm."lastReadSeq" AND m."authorId" <> ${userId} AND m."deletedAt" IS NULL
      GROUP BY m."chatId"`;
    const unreadBy = new Map(unread.map((r) => [r.chatId, r.n]));

    const lasts = await this.prisma.message.findMany({
      where: { OR: chats.filter((c) => c.lastSeq > 0).map((c) => ({ chatId: c.id, seq: c.lastSeq })) },
      include: REPLY_INCLUDE,
    });
    const lastBy = new Map(lasts.map((m) => [m.chatId, m]));

    return chats.map((c) => this.toDto(c, userId, unreadBy.get(c.id) ?? 0, lastBy.get(c.id)));
  }

  async get(chatId: string, userId: string): Promise<ChatDto> {
    const { chat } = await this.requireMember(chatId, userId);
    const [unread] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM "Message" m
      JOIN "ChatMember" cm ON cm."chatId" = m."chatId" AND cm."userId" = ${userId}
      WHERE m."chatId" = ${chatId} AND m.seq > cm."lastReadSeq" AND m."authorId" <> ${userId} AND m."deletedAt" IS NULL`;
    const last = chat.lastSeq > 0 ? await this.prisma.message.findUnique({ where: { chatId_seq: { chatId, seq: chat.lastSeq } }, include: REPLY_INCLUDE }) : null;
    return this.toDto(chat, userId, unread?.n ?? 0, last ?? undefined);
  }

  private toDto(
    c: Prisma.ChatGetPayload<{ include: typeof withMembers }>,
    userId: string,
    unreadCount: number,
    last?: Parameters<typeof toMessageDto>[0],
  ): ChatDto {
    return {
      id: c.id,
      type: c.type,
      title: c.title,
      members: c.members.map((m) => ({ userId: m.userId, role: m.role, lastReadSeq: m.lastReadSeq })),
      lastMessage: last ? toMessageDto(last) : null,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      unreadCount,
      notifyMode: c.members.find((m) => m.userId === userId)!.notifyMode,
    };
  }

  /** One direct chat per pair of people: asking again returns the existing one. */
  async createDirect(userId: string, otherId: string) {
    if (userId === otherId) throw new BadRequestException('CANNOT_CHAT_WITH_SELF');
    await this.assertActiveUsers([otherId]);
    const directKey = [userId, otherId].sort().join(':');
    const existing = await this.prisma.chat.findUnique({ where: { directKey } });
    if (existing) return this.get(existing.id, userId);
    try {
      const chat = await this.prisma.chat.create({
        data: {
          type: 'DIRECT',
          directKey,
          createdById: userId,
          members: { create: [{ userId, role: 'MEMBER' }, { userId: otherId, role: 'MEMBER' }] },
        },
      });
      this.realtime.emit([userId, otherId], 'chat:updated', { chatId: chat.id });
      return this.get(chat.id, userId);
    } catch (e) {
      // two people opened the chat at the same moment: the unique key made one of them lose; return the winner's chat
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const winner = await this.prisma.chat.findUniqueOrThrow({ where: { directKey } });
        return this.get(winner.id, userId);
      }
      throw e;
    }
  }

  async createGroup(userId: string, title: string, memberIds: string[], ip?: string) {
    const others = [...new Set(memberIds)].filter((id) => id !== userId);
    if (others.length === 0) throw new BadRequestException('GROUP_NEEDS_MEMBERS');
    if (others.length + 1 > GROUP_MAX_MEMBERS) throw new BadRequestException('GROUP_TOO_LARGE');
    await this.assertActiveUsers(others);
    const chat = await this.prisma.chat.create({
      data: {
        type: 'GROUP',
        title: title.trim(),
        createdById: userId,
        members: { create: [{ userId, role: 'OWNER' }, ...others.map((id) => ({ userId: id, role: 'MEMBER' as const }))] },
      },
    });
    await this.audit.log({ actorId: userId, action: 'chat.created', entityType: 'Chat', entityId: chat.id, data: { memberIds: others }, ip });
    this.realtime.emit([userId, ...others], 'chat:updated', { chatId: chat.id });
    return this.get(chat.id, userId);
  }

  private requireGroupOwner(chat: { type: string }, me: { role: string }) {
    if (chat.type !== 'GROUP') throw new BadRequestException('NOT_A_GROUP');
    if (me.role !== 'OWNER') throw new ForbiddenException('FORBIDDEN');
  }

  async rename(chatId: string, userId: string, title: string, ip?: string) {
    const { chat, me } = await this.requireMember(chatId, userId);
    this.requireGroupOwner(chat, me);
    await this.prisma.chat.update({ where: { id: chatId }, data: { title: title.trim() } });
    await this.audit.log({ actorId: userId, action: 'chat.renamed', entityType: 'Chat', entityId: chatId, data: { title }, ip });
    this.realtime.emit(this.memberIds(chat), 'chat:updated', { chatId });
    return this.get(chatId, userId);
  }

  async addMembers(chatId: string, userId: string, userIds: string[], ip?: string) {
    const { chat, me } = await this.requireMember(chatId, userId);
    this.requireGroupOwner(chat, me);
    const existing = new Set(this.memberIds(chat));
    const fresh = [...new Set(userIds)].filter((id) => !existing.has(id));
    if (existing.size + fresh.length > GROUP_MAX_MEMBERS) throw new BadRequestException('GROUP_TOO_LARGE');
    await this.assertActiveUsers(fresh);
    if (fresh.length) {
      // newcomers start with the whole history marked read, so they are not greeted by a huge unread counter
      await this.prisma.chatMember.createMany({ data: fresh.map((id) => ({ chatId, userId: id, lastReadSeq: chat.lastSeq })) });
      await this.audit.log({ actorId: userId, action: 'chat.members_added', entityType: 'Chat', entityId: chatId, data: { userIds: fresh }, ip });
      this.realtime.emit([...existing, ...fresh], 'chat:updated', { chatId });
    }
    return this.get(chatId, userId);
  }

  /** The owner removes someone, or anyone leaves on their own. */
  async removeMember(chatId: string, actorId: string, targetId: string, ip?: string) {
    const { chat, me } = await this.requireMember(chatId, actorId);
    if (chat.type !== 'GROUP') throw new BadRequestException('NOT_A_GROUP');
    if (targetId !== actorId && me.role !== 'OWNER') throw new ForbiddenException('FORBIDDEN');
    const target = chat.members.find((m) => m.userId === targetId);
    if (!target) throw new NotFoundException('USER_NOT_FOUND');
    await this.prisma.chatMember.delete({ where: { chatId_userId: { chatId, userId: targetId } } });
    // an owner who leaves hands the group to the longest-standing member, so the group is never ownerless
    if (target.role === 'OWNER') {
      const heir = chat.members.filter((m) => m.userId !== targetId).sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0];
      if (heir) await this.prisma.chatMember.update({ where: { chatId_userId: { chatId, userId: heir.userId } }, data: { role: 'OWNER' } });
    }
    await this.audit.log({ actorId, action: targetId === actorId ? 'chat.left' : 'chat.member_removed', entityType: 'Chat', entityId: chatId, data: { userId: targetId }, ip });
    this.realtime.emit(this.memberIds(chat), 'chat:updated', { chatId });
  }

  async setNotifyMode(chatId: string, userId: string, notifyMode: NotifyMode) {
    await this.requireMember(chatId, userId);
    await this.prisma.chatMember.update({ where: { chatId_userId: { chatId, userId } }, data: { notifyMode } });
    return { notifyMode };
  }

  /** Marks everything up to `seq` as read. Never moves backwards and never past the last message. */
  async markRead(chatId: string, userId: string, seq: number) {
    const { chat, me } = await this.requireMember(chatId, userId);
    const target = Math.min(Math.max(seq, me.lastReadSeq), chat.lastSeq);
    if (target !== me.lastReadSeq) {
      await this.prisma.chatMember.update({ where: { chatId_userId: { chatId, userId } }, data: { lastReadSeq: target } });
      this.realtime.emit(this.memberIds(chat), 'chat:read', { chatId, userId, lastReadSeq: target });
    }
    return { lastReadSeq: target };
  }
}
