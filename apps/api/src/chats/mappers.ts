import type { Message } from '@prisma/client';
import type { MessageDto } from '@hemcenter/shared';

type MessageWithReply = Message & { replyTo?: Pick<Message, 'id' | 'authorId' | 'body' | 'deletedAt'> | null };

export const toMessageDto = (m: MessageWithReply): MessageDto => ({
  id: m.id,
  chatId: m.chatId,
  seq: m.seq,
  authorId: m.authorId,
  body: m.deletedAt ? null : m.body,
  replyTo: m.replyTo ? { id: m.replyTo.id, authorId: m.replyTo.authorId, body: m.replyTo.deletedAt ? null : m.replyTo.body } : null,
  mentionIds: m.deletedAt ? [] : m.mentionIds,
  createdAt: m.createdAt.toISOString(),
  editedAt: m.editedAt?.toISOString() ?? null,
  deleted: m.deletedAt !== null,
});

export const REPLY_INCLUDE = { replyTo: { select: { id: true, authorId: true, body: true, deletedAt: true } } } as const;
