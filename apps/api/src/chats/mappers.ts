import type { Decision, DecisionResponse, Message, Task } from '@prisma/client';
import type { DecisionDto, MessageDto, TaskCardDto } from '@hemcenter/shared';
import { dateOnly, decisionStatus, isOverdue } from '../projects/project-rules';
import { toAttachmentDto } from '../files/files.service';

type AttachmentRow = { id: string; name: string; mime: string; size: number };
type TaskRow = Pick<Task, 'id' | 'title' | 'assigneeId' | 'dueDate' | 'status'>;
type DecisionRow = Decision & { responses: DecisionResponse[] };
type MessageWithReply = Message & {
  replyTo?: Pick<Message, 'id' | 'authorId' | 'body' | 'deletedAt'> | null;
  attachments?: AttachmentRow[];
  tasks?: TaskRow[];
  decision?: DecisionRow | null;
};

export const toTaskCard = (t: TaskRow): TaskCardDto => ({
  id: t.id,
  title: t.title,
  assigneeId: t.assigneeId,
  dueDate: dateOnly(t.dueDate),
  status: t.status,
  overdue: isOverdue(t.dueDate, t.status === 'DONE'),
});

export const toDecisionDto = (d: DecisionRow): DecisionDto => ({
  id: d.id,
  text: d.text,
  createdById: d.createdById,
  addresseeIds: d.addresseeIds,
  responses: d.responses.map((r) => ({ userId: r.userId, answer: r.answer, comment: r.comment, at: r.at.toISOString() })),
  status: decisionStatus(d.addresseeIds, d.responses),
  projectId: d.projectId,
  sourceChatId: d.sourceChatId,
  createdAt: d.createdAt.toISOString(),
});

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
  tasks: m.deletedAt ? [] : (m.tasks ?? []).map(toTaskCard),
  decision: m.deletedAt || !m.decision ? null : toDecisionDto(m.decision),
});

/** What every message query loads: the quoted message and the files that are still available. */
export const REPLY_INCLUDE = {
  replyTo: { select: { id: true, authorId: true, body: true, deletedAt: true } },
  attachments: { where: { deletedAt: null }, select: { id: true, name: true, mime: true, size: true }, orderBy: { createdAt: 'asc' } },
  tasks: { select: { id: true, title: true, assigneeId: true, dueDate: true, status: true }, orderBy: { createdAt: 'asc' } },
  decision: { include: { responses: { orderBy: { at: 'asc' } } } },
} as const;
