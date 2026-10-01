import type { Message } from '@prisma/client';
import type { MessageDto } from '@hemcenter/shared';
import { toAttachmentDto } from '../files/files.service';

type AttachmentRow = { id: string; name: string; mime: string; size: number };
type MessageWithReply = Message & { replyTo?: Pick<Message, 'id' | 'authorId' | 'body' | 'deletedAt'> | null; attachments?: AttachmentRow[] };

export const toMessageDto = (m: MessageWithReply): MessageDto => ({
  id: m.id,
  chatId: m.chatId,
  seq: m.seq,
  authorId: m.authorId,
  body: m.deletedAt ? null : m.body,
  replyTo: m.replyTo ? { id: m.replyTo.id, authorId: m.replyTo.authorId, body: m.replyTo.deletedAt ? null : m.replyTo.body } : null,
  mentionIds: m.deletedAt ? [] : m.mentionIds,
  attachments: m.deletedAt ? [] : (m.attachments ?? []).map(toAttachmentDto),
  createdAt: m.createdAt.toISOString(),
  editedAt: m.editedAt?.toISOString() ?? null,
  deleted: m.deletedAt !== null,
});

/** What every message query loads: the quoted message and the files that are still available. */
export const REPLY_INCLUDE = {
  replyTo: { select: { id: true, authorId: true, body: true, deletedAt: true } },
  attachments: { where: { deletedAt: null }, select: { id: true, name: true, mime: true, size: true }, orderBy: { createdAt: 'asc' } },
} as const;
