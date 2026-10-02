import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Assignment, DueChange, ExecutionReport, Prisma, ReportFile, User } from '@prisma/client';
import type { AssignmentDto, DocData, NotificationType } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { FileStorage } from '../files/file-storage';
import { hasBlockedExtension, maxUploadBytes, repairFileNameEncoding, sanitizeFileName, sniffImage } from '../files/file-rules';
import { ChatsService } from '../chats/chats.service';
import { NotificationsService } from '../notifications/notifications.service';
import { dateOnly, parseDate, todayIn } from '../projects/project-rules';
import { isOverseer } from '../projects/projects.service';
import { ACTIONABLE, canReport, canReview, canStart, dayDiff, isFinished, isOverdue, reminderFor } from './assignment-rules';
import type { CreateAssignmentDto, DueRequestDto } from './dto';

/** Who may give assignments by hand: the people who run things. Anyone may be given one. */
export const GIVES_ASSIGNMENTS = ['ADMIN', 'MANAGEMENT', 'PROJECT_MANAGER', 'SECRETARY'] as const;
export const mayGive = (u: Pick<User, 'roles'>) => u.roles.some((r) => (GIVES_ASSIGNMENTS as readonly string[]).includes(r));

const DETAIL = {
  reports: { orderBy: { createdAt: 'asc' }, include: { files: true } },
  dueChanges: { orderBy: { createdAt: 'asc' } },
  events: { orderBy: { at: 'asc' } },
} satisfies Prisma.AssignmentInclude;
type Detailed = Prisma.AssignmentGetPayload<{ include: typeof DETAIL }>;

async function lock(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Assignment" WHERE id = ${id} FOR UPDATE`;
}

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
    private readonly chats: ChatsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- mapping and access ----
  private roles(a: Pick<Assignment, 'responsibleId' | 'coResponsibleIds' | 'controllerId' | 'createdById'>, u: Pick<User, 'id' | 'roles'>) {
    return {
      responsible: a.responsibleId === u.id,
      co: a.coResponsibleIds.includes(u.id),
      controller: a.controllerId === u.id,
      creator: a.createdById === u.id,
      overseer: u.roles.includes('ADMIN') || u.roles.includes('MANAGEMENT'),
    };
  }

  private toDto(a: Assignment & Partial<Detailed>, u: User): AssignmentDto {
    const r = this.roles(a, u);
    const today = todayIn();
    const reports = a.reports ?? [];
    const dueChanges = a.dueChanges ?? [];
    const open = !isFinished(a.status);
    const pendingDue = dueChanges.some((d) => d.status === 'PENDING');
    return {
      id: a.id,
      text: a.text,
      responsibleId: a.responsibleId,
      coResponsibleIds: a.coResponsibleIds,
      controllerId: a.controllerId,
      dueDate: dateOnly(a.dueDate)!,
      originalDue: dateOnly(a.originalDue)!,
      status: a.status,
      overdue: isOverdue(a.status, dateOnly(a.dueDate)!, today),
      doneAt: a.doneAt?.toISOString() ?? null,
      removedReason: a.removedReason,
      sourceKind: a.sourceKind,
      sourceDocumentId: a.sourceDocumentId,
      sourceChatId: a.sourceChatId,
      createdById: a.createdById,
      createdAt: a.createdAt.toISOString(),
      reports: reports.map((x: ExecutionReport & { files: ReportFile[] }) => ({
        id: x.id, authorId: x.authorId, text: x.text, status: x.status, reviewerId: x.reviewerId, reviewComment: x.reviewComment, reviewedAt: x.reviewedAt?.toISOString() ?? null,
        files: x.files.map((f) => ({ id: f.id, name: f.name, size: f.size })), createdAt: x.createdAt.toISOString(),
      })),
      dueChanges: dueChanges.map((d: DueChange) => ({
        id: d.id, requestedById: d.requestedById, oldDue: dateOnly(d.oldDue)!, newDue: dateOnly(d.newDue)!, reason: d.reason, status: d.status,
        decidedById: d.decidedById, decisionNote: d.decisionNote, decidedAt: d.decidedAt?.toISOString() ?? null, createdAt: d.createdAt.toISOString(),
      })),
      events: (a.events ?? []).map((e) => ({ id: e.id, actorId: e.actorId, kind: e.kind, comment: e.comment, at: e.at.toISOString() })),
      can: {
        start: r.responsible && canStart(a.status),
        report: r.responsible && canReport(a.status),
        review: (r.controller || u.roles.includes('ADMIN')) && canReview(a.status),
        requestDue: r.responsible && ACTIONABLE.includes(a.status) && !pendingDue,
        decideDue: (r.controller || u.roles.includes('ADMIN')) && open && pendingDue,
        remove: (r.controller || r.creator || r.overseer) && open,
      },
    };
  }

  private visible(a: Pick<Assignment, 'responsibleId' | 'coResponsibleIds' | 'controllerId' | 'createdById'>, u: User) {
    const r = this.roles(a, u);
    return r.responsible || r.co || r.controller || r.creator || r.overseer;
  }

  private async load(id: string, u: User) {
    const a = await this.prisma.assignment.findUnique({ where: { id }, include: DETAIL });
    if (!a || !this.visible(a, u)) throw new NotFoundException('ASSIGNMENT_NOT_FOUND');
    return a;
  }

  private async view(id: string, u: User) {
    return this.toDto(await this.load(id, u), u);
  }

  private async assertActive(ids: string[]) {
    const unique = [...new Set(ids)];
    if ((await this.prisma.user.count({ where: { id: { in: unique }, isActive: true, isExternal: false } })) !== unique.length) throw new BadRequestException('USER_NOT_FOUND');
  }

  private futureDate(v: string) {
    const d = parseDate(v);
    if (!d) throw new BadRequestException('INVALID_DATE');
    if (v < todayIn()) throw new BadRequestException('DUE_IN_PAST');
    return d;
  }

  private async event(tx: Prisma.TransactionClient, assignmentId: string, actorId: string, kind: Prisma.AssignmentEventUncheckedCreateInput['kind'], comment?: string | null) {
    await tx.assignmentEvent.create({ data: { assignmentId, actorId, kind, comment: comment ?? null } });
  }

  // ---- creating ----
  async create(actor: User, dto: CreateAssignmentDto, ip?: string) {
    if (!mayGive(actor)) throw new ForbiddenException('FORBIDDEN');
    return this.createChecked(actor, dto, { sourceKind: 'MANUAL' }, ip);
  }

  /** An assignment made from a chat message: the person giving it and the responsible one are both in that chat. */
  async createFromMessage(actor: User, chatId: string, messageId: string, dto: CreateAssignmentDto, ip?: string) {
    if (!mayGive(actor)) throw new ForbiddenException('FORBIDDEN');
    const { chat } = await this.chats.requireMember(chatId, actor.id);
    ChatsService.assertWritable(chat);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, chatId } });
    if (!message) throw new NotFoundException('MESSAGE_NOT_FOUND');
    if (message.deletedAt) throw new BadRequestException('MESSAGE_DELETED');
    const members = chat.members.map((m) => m.userId);
    if (![dto.responsibleId, ...(dto.coResponsibleIds ?? [])].every((id) => members.includes(id))) throw new BadRequestException('ASSIGNEE_NOT_IN_CHAT');
    return this.createChecked(actor, dto, { sourceKind: 'CHAT', sourceChatId: chatId, sourceMessageId: messageId }, ip);
  }

  private async createChecked(actor: User, dto: CreateAssignmentDto, source: Pick<Prisma.AssignmentUncheckedCreateInput, 'sourceKind' | 'sourceChatId' | 'sourceMessageId'>, ip?: string) {
    const controllerId = dto.controllerId ?? actor.id;
    const co = [...new Set(dto.coResponsibleIds ?? [])].filter((id) => id !== dto.responsibleId);
    await this.assertActive([dto.responsibleId, controllerId, ...co]);
    const due = this.futureDate(dto.dueDate);
    const a = await this.prisma.$transaction(async (tx) => {
      const created = await tx.assignment.create({
        data: { text: dto.text, responsibleId: dto.responsibleId, coResponsibleIds: co, controllerId, dueDate: due, originalDue: due, createdById: actor.id, ...source },
      });
      await this.event(tx, created.id, actor.id, 'CREATED');
      return created;
    });
    await this.audit.log({ actorId: actor.id, action: 'assignment.created', entityType: 'Assignment', entityId: a.id, data: { responsibleId: a.responsibleId, controllerId, due: dto.dueDate, source: a.sourceKind }, ip });
    await this.notifications.send([a.responsibleId, ...co], 'ASSIGNED', a.id);
    return this.view(a.id, actor);
  }

  /**
   * Called in the registration transaction: every item of the document that names a person and a date becomes an
   * assignment. Running it again for the same document creates nothing new.
   */
  async createForDocument(tx: Prisma.TransactionClient, doc: { id: string; data: unknown; authorId: string }, actor: User): Promise<Assignment[]> {
    const data = (doc.data ?? {}) as DocData;
    const meeting = await tx.meeting.findUnique({ where: { protocolId: doc.id }, select: { chairId: true } });
    const controllerId = meeting?.chairId ?? doc.authorId;
    const created: Assignment[] = [];
    const items = data.items ?? [];
    for (const [i, item] of items.entries()) {
      const due = item.due ? parseDate(item.due) : null;
      if (!item.responsibleId || !due || !item.text?.trim()) continue;
      const person = await tx.user.findFirst({ where: { id: item.responsibleId, isActive: true, isExternal: false }, select: { id: true } });
      if (!person) continue;
      const key = `item-${i}`;
      if (await tx.assignment.findUnique({ where: { sourceDocumentId_sourceResolutionId: { sourceDocumentId: doc.id, sourceResolutionId: key } } })) continue;
      const a = await tx.assignment.create({
        data: { text: item.text.trim(), responsibleId: person.id, controllerId, dueDate: due, originalDue: due, sourceKind: 'DOCUMENT', sourceDocumentId: doc.id, sourceResolutionId: key, createdById: actor.id },
      });
      await this.event(tx, a.id, actor.id, 'CREATED');
      created.push(a);
    }
    return created;
  }

  /** After the registration has been committed. */
  async announce(list: Assignment[]) {
    for (const a of list) await this.notifications.send([a.responsibleId], 'ASSIGNED', a.id);
  }

  // ---- reading ----
  async list(actor: User, q: { scope?: string; state?: string; documentId?: string }) {
    const me = actor.id;
    const and: Prisma.AssignmentWhereInput[] = [];
    if (q.scope === 'control') and.push({ controllerId: me });
    else if (q.scope === 'all') {
      if (!(actor.roles.includes('ADMIN') || actor.roles.includes('MANAGEMENT'))) throw new ForbiddenException('FORBIDDEN');
    } else and.push({ OR: [{ responsibleId: me }, { coResponsibleIds: { has: me } }] });
    if (q.state === 'open') and.push({ status: { notIn: ['DONE', 'REMOVED'] } });
    if (q.state === 'done') and.push({ status: 'DONE' });
    if (q.state === 'review') and.push({ status: 'REVIEW' });
    if (q.documentId) and.push({ sourceDocumentId: q.documentId });
    const rows = await this.prisma.assignment.findMany({ where: { AND: and }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }], take: 300 });
    const dtos = rows.map((a) => this.toDto(a, actor));
    return q.state === 'overdue' ? dtos.filter((d) => d.overdue) : dtos;
  }

  get(id: string, actor: User) {
    return this.view(id, actor);
  }

  /** For the head of the centre: what is late, and with whom. */
  async summary(actor: User) {
    if (!(actor.roles.includes('ADMIN') || actor.roles.includes('MANAGEMENT'))) throw new ForbiddenException('FORBIDDEN');
    const today = todayIn();
    const rows = await this.prisma.assignment.findMany({ where: { status: { in: [...ACTIONABLE] }, dueDate: { lt: parseDate(today)! } }, orderBy: { dueDate: 'asc' }, take: 500 });
    const byPerson = new Map<string, number>();
    rows.forEach((a) => byPerson.set(a.responsibleId, (byPerson.get(a.responsibleId) ?? 0) + 1));
    return {
      overdue: rows.map((a) => this.toDto(a, actor)),
      byPerson: [...byPerson].map(([userId, count]) => ({ userId, count })).sort((x, y) => y.count - x.count),
    };
  }

  // ---- doing ----
  private async act(actor: User, id: string, fn: (tx: Prisma.TransactionClient, a: Assignment) => Promise<void>) {
    await this.load(id, actor); // 404 for strangers
    await this.prisma.$transaction(async (tx) => {
      await lock(tx, id);
      await fn(tx, await tx.assignment.findUniqueOrThrow({ where: { id } }));
    });
  }

  async start(actor: User, id: string, ip?: string) {
    await this.act(actor, id, async (tx, a) => {
      if (a.responsibleId !== actor.id) throw new ForbiddenException('FORBIDDEN');
      if (!canStart(a.status)) throw new ConflictException('WRONG_STATE');
      await tx.assignment.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
      await this.event(tx, id, actor.id, 'STARTED');
    });
    await this.audit.log({ actorId: actor.id, action: 'assignment.started', entityType: 'Assignment', entityId: id, ip });
    return this.view(id, actor);
  }

  async report(actor: User, id: string, text: string, files: Express.Multer.File[], ip?: string) {
    const stored: { name: string; mime: string; size: number; sha256: string; storageKey: string }[] = [];
    try {
      for (const f of files) {
        if (f.size === 0) throw new BadRequestException('EMPTY_FILE');
        if (f.size > maxUploadBytes()) throw new PayloadTooLargeException('FILE_TOO_LARGE');
        const name = sanitizeFileName(repairFileNameEncoding(f.originalname)) || 'file';
        if (hasBlockedExtension(name)) throw new BadRequestException('FILE_TYPE_NOT_ALLOWED');
        stored.push({ name, mime: sniffImage(f.buffer) ?? 'application/octet-stream', size: f.size, sha256: createHash('sha256').update(f.buffer).digest('hex'), storageKey: await this.storage.save(f.buffer) });
      }
      let controllerId = '';
      await this.act(actor, id, async (tx, a) => {
        if (a.responsibleId !== actor.id) throw new ForbiddenException('FORBIDDEN');
        if (!canReport(a.status)) throw new ConflictException('WRONG_STATE');
        controllerId = a.controllerId;
        await tx.executionReport.create({ data: { assignmentId: id, authorId: actor.id, text, files: { create: stored } } });
        await tx.assignment.update({ where: { id }, data: { status: 'REVIEW' } });
        await this.event(tx, id, actor.id, 'REPORT');
      });
      await this.audit.log({ actorId: actor.id, action: 'assignment.reported', entityType: 'Assignment', entityId: id, data: { files: stored.map((s) => ({ name: s.name, sha256: s.sha256 })) }, ip });
      await this.notifications.send([controllerId], 'REPORT_SUBMITTED', id);
    } catch (e) {
      await Promise.all(stored.map((s) => this.storage.remove(s.storageKey))); // never keep bytes without a report
      throw e;
    }
    return this.view(id, actor);
  }

  async review(actor: User, id: string, reportId: string, accept: boolean, comment: string | undefined, ip?: string) {
    const note = comment?.trim() || null;
    if (!accept && !note) throw new BadRequestException('COMMENT_REQUIRED');
    let responsibleId = '';
    await this.act(actor, id, async (tx, a) => {
      if (a.controllerId !== actor.id && !actor.roles.includes('ADMIN')) throw new ForbiddenException('FORBIDDEN');
      if (!canReview(a.status)) throw new ConflictException('WRONG_STATE');
      const rep = await tx.executionReport.findFirst({ where: { id: reportId, assignmentId: id, status: 'PENDING' } });
      if (!rep) throw new ConflictException('REPORT_NOT_PENDING');
      responsibleId = a.responsibleId;
      await tx.executionReport.update({ where: { id: reportId }, data: { status: accept ? 'ACCEPTED' : 'RETURNED', reviewerId: actor.id, reviewComment: note, reviewedAt: new Date() } });
      await tx.assignment.update({ where: { id }, data: accept ? { status: 'DONE', doneAt: new Date() } : { status: 'RETURNED' } });
      await this.event(tx, id, actor.id, accept ? 'ACCEPTED' : 'RETURNED', note);
    });
    await this.audit.log({ actorId: actor.id, action: accept ? 'assignment.accepted' : 'assignment.report_returned', entityType: 'Assignment', entityId: id, data: { reportId, comment: note }, ip });
    await this.notifications.send([responsibleId], accept ? 'REPORT_ACCEPTED' : 'REPORT_RETURNED', id);
    return this.view(id, actor);
  }

  async requestDue(actor: User, id: string, dto: DueRequestDto, ip?: string) {
    const newDue = this.futureDate(dto.newDue);
    let controllerId = '';
    await this.act(actor, id, async (tx, a) => {
      if (a.responsibleId !== actor.id) throw new ForbiddenException('FORBIDDEN');
      if (!ACTIONABLE.includes(a.status)) throw new ConflictException('WRONG_STATE');
      if (dateOnly(a.dueDate) === dto.newDue) throw new BadRequestException('SAME_DUE');
      if (await tx.dueChange.count({ where: { assignmentId: id, status: 'PENDING' } })) throw new ConflictException('DUE_REQUEST_PENDING');
      controllerId = a.controllerId;
      await tx.dueChange.create({ data: { assignmentId: id, requestedById: actor.id, oldDue: a.dueDate, newDue, reason: dto.reason } });
      await this.event(tx, id, actor.id, 'DUE_REQUESTED', dto.reason);
    });
    await this.audit.log({ actorId: actor.id, action: 'assignment.due_requested', entityType: 'Assignment', entityId: id, data: { newDue: dto.newDue, reason: dto.reason }, ip });
    await this.notifications.send([controllerId], 'DUE_REQUESTED', id);
    return this.view(id, actor);
  }

  async decideDue(actor: User, id: string, requestId: string, approve: boolean, note: string | undefined, ip?: string) {
    const text = note?.trim() || null;
    let responsibleId = '';
    await this.act(actor, id, async (tx, a) => {
      if (a.controllerId !== actor.id && !actor.roles.includes('ADMIN')) throw new ForbiddenException('FORBIDDEN');
      if (isFinished(a.status)) throw new ConflictException('WRONG_STATE');
      const req = await tx.dueChange.findFirst({ where: { id: requestId, assignmentId: id, status: 'PENDING' } });
      if (!req) throw new ConflictException('DUE_REQUEST_NOT_PENDING');
      responsibleId = a.responsibleId;
      await tx.dueChange.update({ where: { id: requestId }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: actor.id, decisionNote: text, decidedAt: new Date() } });
      if (approve) await tx.assignment.update({ where: { id }, data: { dueDate: req.newDue } });
      await this.event(tx, id, actor.id, approve ? 'DUE_APPROVED' : 'DUE_REJECTED', text);
    });
    await this.audit.log({ actorId: actor.id, action: approve ? 'assignment.due_approved' : 'assignment.due_rejected', entityType: 'Assignment', entityId: id, data: { requestId, note: text }, ip });
    await this.notifications.send([responsibleId], approve ? 'DUE_APPROVED' : 'DUE_REJECTED', id);
    return this.view(id, actor);
  }

  async remove(actor: User, id: string, reason: string, ip?: string) {
    let responsibleId = '';
    await this.act(actor, id, async (tx, a) => {
      const r = this.roles(a, actor);
      if (!(r.controller || r.creator || r.overseer)) throw new ForbiddenException('FORBIDDEN');
      if (isFinished(a.status)) throw new ConflictException('WRONG_STATE');
      responsibleId = a.responsibleId;
      await tx.assignment.update({ where: { id }, data: { status: 'REMOVED', removedReason: reason } });
      await tx.dueChange.updateMany({ where: { assignmentId: id, status: 'PENDING' }, data: { status: 'REJECTED', decidedById: actor.id, decisionNote: reason, decidedAt: new Date() } });
      await this.event(tx, id, actor.id, 'REMOVED', reason);
    });
    await this.audit.log({ actorId: actor.id, action: 'assignment.removed', entityType: 'Assignment', entityId: id, data: { reason }, ip });
    await this.notifications.send([responsibleId], 'REMOVED', id);
    return this.view(id, actor);
  }

  /** A file of a report, for those who may see the assignment. */
  async openFile(actor: User, fileId: string) {
    const f = await this.prisma.reportFile.findUnique({ where: { id: fileId }, include: { report: { include: { assignment: true } } } });
    if (!f || !this.visible(f.report.assignment, actor) || !(await this.storage.exists(f.storageKey))) throw new NotFoundException('FILE_NOT_FOUND');
    return { stream: this.storage.open(f.storageKey), name: f.name, mime: f.mime, size: f.size };
  }

  // ---- reminders ----
  /** Sends today's reminders (3 days, 1 day, the day, daily when late). Each kind goes out once per assignment per day. */
  async remind(now = new Date()): Promise<number> {
    const today = todayIn(undefined, now);
    const horizon = parseDate(new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10))!;
    const rows = await this.prisma.assignment.findMany({ where: { status: { in: [...ACTIONABLE] }, dueDate: { lte: horizon } } });
    let sent = 0;
    for (const a of rows) {
      const rem = reminderFor(dayDiff(dateOnly(a.dueDate)!, today));
      if (!rem) continue;
      const fresh = await this.prisma.reminderLog.createMany({ data: [{ assignmentId: a.id, kind: rem.kind, day: parseDate(today)! }], skipDuplicates: true });
      if (fresh.count === 0) continue;
      // when it is late the controller hears about it too
      await this.notifications.send(rem.kind === 'OVERDUE' ? [a.responsibleId, a.controllerId] : [a.responsibleId], rem.type as NotificationType, a.id);
      sent += 1;
    }
    return sent;
  }
}
