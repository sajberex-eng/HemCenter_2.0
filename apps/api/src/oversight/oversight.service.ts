import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { MessagesService } from '../chats/messages.service';
import { FilesService } from '../files/files.service';

export const OVERSIGHT_LIST_LIMIT = 200;

type Paging = { before?: number; after?: number; around?: number; limit?: number };

/**
 * "Management view" (decided 02.10.2026): people with the MANAGEMENT role may read any chat, but only here, never
 * through the ordinary chat endpoints (those keep answering 404 to non-members). Everything is read-only and every
 * call is written to the append-only audit log; chat members can see how many times their chat was opened.
 */
@Injectable()
export class OversightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly messages: MessagesService,
    private readonly files: FilesService,
  ) {}

  async listChats(actorId: string, q: string | undefined, ip?: string) {
    const term = q?.trim();
    const chats = await this.prisma.chat.findMany({
      where: term
        ? {
            OR: [
              { title: { contains: term, mode: 'insensitive' } },
              { members: { some: { user: { fullName: { contains: term, mode: 'insensitive' } } } } },
            ],
          }
        : undefined,
      include: { members: { select: { userId: true, user: { select: { fullName: true } } } } },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: OVERSIGHT_LIST_LIMIT,
    });
    await this.audit.log({ actorId, action: 'oversight.chats_listed', data: term ? { q: term } : undefined, ip });
    return chats.map((c) => ({
      id: c.id,
      type: c.type,
      title: c.title,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      members: c.members.map((m) => ({ userId: m.userId, fullName: m.user.fullName })),
    }));
  }

  private async chat(chatId: string) {
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId }, include: { members: { select: { userId: true, user: { select: { fullName: true } } } } } });
    if (!chat) throw new NotFoundException('CHAT_NOT_FOUND');
    return chat;
  }

  async openChat(actorId: string, chatId: string, ip?: string) {
    const c = await this.chat(chatId);
    await this.audit.log({ actorId, action: 'oversight.chat_opened', entityType: 'Chat', entityId: chatId, data: { chatId, type: c.type }, ip });
    return {
      id: c.id,
      type: c.type,
      title: c.title,
      lastSeq: c.lastSeq,
      members: c.members.map((m) => ({ userId: m.userId, fullName: m.user.fullName })),
    };
  }

  async readMessages(actorId: string, chatId: string, opts: Paging, ip?: string) {
    const c = await this.chat(chatId);
    const page = await this.messages.page(c, opts);
    const seqs = page.messages.map((m) => m.seq);
    await this.audit.log({
      actorId,
      action: 'oversight.messages_read',
      entityType: 'Chat',
      entityId: chatId,
      data: { chatId, count: seqs.length, fromSeq: seqs[0] ?? null, toSeq: seqs[seqs.length - 1] ?? null },
      ip,
    });
    return page;
  }

  async openFile(actorId: string, attachmentId: string, ip?: string) {
    const opened = await this.files.openForOversight(attachmentId);
    await this.audit.log({
      actorId,
      action: 'oversight.file_opened',
      entityType: 'Attachment',
      entityId: attachmentId,
      data: { chatId: opened.attachment.chatId, name: opened.attachment.name },
      ip,
    });
    return opened;
  }

  /** What the chat's own members may know: how often, and when last, management opened the conversation. */
  async viewsOf(chatId: string, userId: string) {
    const member = await this.prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId } } });
    if (!member) throw new NotFoundException('CHAT_NOT_FOUND');
    const [row] = await this.prisma.$queryRaw<{ n: number; last: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MAX("at") AS last FROM "AuditLog"
      WHERE action = 'oversight.chat_opened' AND "entityId" = ${chatId}`;
    return { count: row?.n ?? 0, lastAt: row?.last?.toISOString() ?? null };
  }
}
