import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { MAX_APPROVERS } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { DocumentsService } from './documents.service';
import { activeStage, buildStages, routeProblem, type RouteInput } from './approval-rules';

/** Serialises everything that happens to one document: two approvers pressing at once are handled one after the other. */
export async function lockDocument(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${id} FOR UPDATE`;
}

@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly documents: DocumentsService,
  ) {}

  private async notify(documentId: string) {
    const d = await this.prisma.document.findUnique({ where: { id: documentId }, select: { authorId: true, steps: { select: { approverId: true } } } });
    if (d) this.realtime.emit([...new Set([d.authorId, ...d.steps.map((s) => s.approverId)])], 'document:updated', { documentId });
  }

  /** Sends the document for approval along a route; after a return, sends it again (by default along the same route). */
  async submit(actor: User, id: string, route: RouteInput[] | undefined, comment: string | undefined, ip?: string) {
    const doc = await this.documents.load(id, actor);
    if (doc.authorId !== actor.id) throw new ForbiddenException('FORBIDDEN');

    let chosen = route;
    if (chosen === undefined) {
      if (doc.status !== 'RETURNED' || doc.steps.length === 0) throw new BadRequestException('ROUTE_REQUIRED');
      // the same people, in the same order
      const stages = [...new Set(doc.steps.map((s) => s.stage))].sort((a, b) => a - b);
      chosen = stages.flatMap((st) => doc.steps.filter((s) => s.stage === st).map((s, k) => ({ approverId: s.approverId, parallelWithPrevious: k > 0 })));
    }
    const problem = routeProblem(chosen, actor.id, MAX_APPROVERS);
    if (problem) throw new BadRequestException(problem);
    const approvers = await this.prisma.user.count({ where: { id: { in: chosen.map((r) => r.approverId) }, isActive: true, isExternal: false } });
    if (approvers !== chosen.length) throw new BadRequestException('USER_NOT_FOUND');
    const stages = buildStages(chosen);

    const old = await this.prisma.$transaction(async (tx) => {
      await lockDocument(tx, id);
      const cur = await tx.document.findUniqueOrThrow({ where: { id } });
      if (cur.status !== 'DRAFT' && cur.status !== 'RETURNED') throw new BadRequestException('NOT_SUBMITTABLE');
      await tx.approvalStep.deleteMany({ where: { documentId: id } });
      await tx.approvalStep.createMany({ data: stages.map((s) => ({ documentId: id, approverId: s.approverId, stage: s.stage })) });
      const round = cur.round + 1;
      await tx.document.update({ where: { id }, data: { status: 'IN_REVIEW', round } });
      await tx.approvalAction.create({ data: { documentId: id, round, actorId: actor.id, kind: 'SUBMIT', comment: comment?.trim() || null } });
      return this.documents.invalidateFiles(tx, cur);
    });
    await this.documents.dropFiles(old);
    await this.audit.log({ actorId: actor.id, action: 'document.submitted', entityType: 'Document', entityId: id, data: { route: stages }, ip });
    await this.notify(id);
    return this.documents.get(id, actor);
  }

  private async decide(actor: User, id: string, kind: 'APPROVE' | 'RETURN', comment: string | undefined, ip?: string) {
    const text = comment?.trim() || null;
    if (kind === 'RETURN' && !text) throw new BadRequestException('COMMENT_REQUIRED');
    await this.documents.load(id, actor); // 404 for anyone outside the route
    const old = await this.prisma.$transaction(async (tx) => {
      await lockDocument(tx, id);
      const cur = await tx.document.findUniqueOrThrow({ where: { id }, include: { steps: true } });
      if (cur.status !== 'IN_REVIEW') throw new BadRequestException('NOT_UNDER_REVIEW');
      const mine = cur.steps.find((s) => s.approverId === actor.id);
      if (!mine) throw new ForbiddenException('NOT_AN_APPROVER');
      if (mine.status !== 'PENDING') throw new ConflictException('ALREADY_DECIDED');
      // a later stage waits until the earlier one is complete
      if (mine.stage !== activeStage(cur.steps)) throw new ConflictException('NOT_YOUR_TURN');
      await tx.approvalStep.update({ where: { id: mine.id }, data: { status: kind === 'APPROVE' ? 'APPROVED' : 'RETURNED', decidedAt: new Date(), comment: text } });
      const stillPending = cur.steps.some((s) => s.id !== mine.id && s.status === 'PENDING');
      const status = kind === 'RETURN' ? 'RETURNED' : stillPending ? 'IN_REVIEW' : 'APPROVED';
      await tx.document.update({ where: { id }, data: { status } });
      await tx.approvalAction.create({ data: { documentId: id, round: cur.round, actorId: actor.id, kind, comment: text } });
      return this.documents.invalidateFiles(tx, cur); // the approval sheet in the file has a new line
    });
    await this.documents.dropFiles(old);
    await this.audit.log({ actorId: actor.id, action: kind === 'APPROVE' ? 'document.approved' : 'document.returned', entityType: 'Document', entityId: id, data: { comment: text }, ip });
    await this.notify(id);
    return this.documents.get(id, actor);
  }

  approve(actor: User, id: string, comment: string | undefined, ip?: string) {
    return this.decide(actor, id, 'APPROVE', comment, ip);
  }

  return(actor: User, id: string, comment: string | undefined, ip?: string) {
    return this.decide(actor, id, 'RETURN', comment, ip);
  }
}
