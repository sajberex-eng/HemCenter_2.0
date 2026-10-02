import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { ApprovalAction, ApprovalStep, Document, DocumentKind, Prisma, User } from '@prisma/client';
import { EDITABLE_DOCUMENT_STATUSES, type DocData, type DocumentDto } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { FileStorage } from '../files/file-storage';
import { sanitizeFileName } from '../files/file-rules';
import { parseDate, todayIn, dateOnly } from '../projects/project-rules';
import { KindsTemplatesService } from './kinds-templates.service';
import { PdfConverter } from './pdf-converter';
import { buildContext, renderDocx, TemplateError, type RenderContext } from './render';
import { isAwaiting } from './approval-rules';
import type { CreateDocumentDto, UpdateDocumentDto } from './dto';

/** Roles that see every document (the secretary keeps the registers, management oversees). */
const SEES_ALL = ['SECRETARY', 'ADMIN', 'MANAGEMENT'] as const;
export const seesAllDocuments = (u: Pick<User, 'roles'>) => u.roles.some((r) => (SEES_ALL as readonly string[]).includes(r));

export const toDocumentDto = (d: Document, ctx: { viewerId: string; steps: ApprovalStep[]; actions?: ApprovalAction[] }): DocumentDto => ({
  id: d.id,
  kindId: d.kindId,
  title: d.title,
  lang: d.lang,
  data: d.data as DocData,
  status: d.status,
  docDate: dateOnly(d.docDate)!,
  authorId: d.authorId,
  registrationNumber: d.registrationNumber,
  registeredAt: d.registeredAt?.toISOString() ?? null,
  pdfSha256: d.pdfSha256,
  round: d.round,
  steps: ctx.steps
    .slice()
    .sort((x, y) => x.stage - y.stage)
    .map((x) => ({ id: x.id, approverId: x.approverId, stage: x.stage, status: x.status, decidedAt: x.decidedAt?.toISOString() ?? null, comment: x.comment })),
  actions: (ctx.actions ?? []).map((x) => ({ id: x.id, round: x.round, actorId: x.actorId, kind: x.kind, comment: x.comment, at: x.at.toISOString() })),
  scan: d.scanKey ? { name: d.scanName ?? 'scan', size: d.scanSize ?? 0, sha256: d.scanSha256 ?? '', uploadedAt: d.scanAt!.toISOString() } : null,
  awaitingMe: isAwaiting(ctx.viewerId, d.status, ctx.steps),
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
});

const orgName = (lang: 'ru' | 'kk') => (lang === 'kk' ? process.env.ORG_NAME_KK || 'Гематология орталығы' : process.env.ORG_NAME_RU || 'Центр гематологии');

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
    private readonly pdf: PdfConverter,
    private readonly templates: KindsTemplatesService,
  ) {}

  /** Who may see a document: the author, whoever is in its route, and the secretary, administrators and management. */
  protected canSee(d: Pick<Document, 'authorId'> & { steps: Pick<ApprovalStep, 'approverId'>[] }, u: User) {
    return d.authorId === u.id || seesAllDocuments(u) || d.steps.some((s) => s.approverId === u.id);
  }

  async load(id: string, u: User) {
    const d = await this.prisma.document.findUnique({ where: { id }, include: { steps: true } });
    if (!d || !this.canSee(d, u)) throw new NotFoundException('DOCUMENT_NOT_FOUND');
    return d;
  }

  async create(actor: User, dto: CreateDocumentDto, ip?: string) {
    const kind = await this.prisma.documentKind.findUnique({ where: { id: dto.kindId } });
    if (!kind || !kind.isActive) throw new NotFoundException('KIND_NOT_FOUND');
    const template = await this.templates.activeTemplate(kind.id, dto.lang);
    if (!template) throw new BadRequestException('NO_TEMPLATE');
    const date = dto.docDate ? parseDate(dto.docDate) : parseDate(todayIn());
    if (!date) throw new BadRequestException('INVALID_DATE');
    const doc = await this.prisma.document.create({
      data: { kindId: kind.id, templateId: template.id, title: dto.title.trim(), lang: dto.lang, data: JSON.parse(JSON.stringify(dto.data ?? {})), docDate: date, authorId: actor.id },
    });
    await this.audit.log({ actorId: actor.id, action: 'document.created', entityType: 'Document', entityId: doc.id, data: { kindId: kind.id, lang: dto.lang, title: doc.title }, ip });
    return toDocumentDto(doc, { viewerId: actor.id, steps: [] });
  }

  async list(actor: User, q: { status?: string; kindId?: string; mine?: boolean; awaiting?: boolean }) {
    const and: Prisma.DocumentWhereInput[] = [];
    if (q.status) and.push({ status: q.status as Document['status'] });
    if (q.kindId) and.push({ kindId: q.kindId });
    if (q.mine) and.push({ authorId: actor.id });
    else if (!seesAllDocuments(actor)) and.push({ OR: [{ authorId: actor.id }, { steps: { some: { approverId: actor.id } } }] });
    if (q.awaiting) and.push({ status: 'IN_REVIEW', steps: { some: { approverId: actor.id, status: 'PENDING' } } });
    const rows = await this.prisma.document.findMany({ where: { AND: and }, include: { steps: true }, orderBy: { updatedAt: 'desc' }, take: 200 });
    const dtos = rows.map((d) => toDocumentDto(d, { viewerId: actor.id, steps: d.steps }));
    return q.awaiting ? dtos.filter((d) => d.awaitingMe) : dtos;
  }

  /** How many documents wait for this person's decision right now (for the badge in the menu). */
  async awaitingCount(actor: User) {
    return (await this.list(actor, { awaiting: true })).length;
  }

  async get(id: string, actor: User) {
    const d = await this.load(id, actor);
    const actions = await this.prisma.approvalAction.findMany({ where: { documentId: id }, orderBy: { at: 'asc' } });
    return toDocumentDto(d, { viewerId: actor.id, steps: d.steps, actions });
  }

  async update(id: string, actor: User, dto: UpdateDocumentDto, ip?: string) {
    const d = await this.load(id, actor);
    if (d.authorId !== actor.id) throw new ForbiddenException('FORBIDDEN');
    if (!EDITABLE_DOCUMENT_STATUSES.includes(d.status)) throw new BadRequestException('DOCUMENT_LOCKED');
    const data: Prisma.DocumentUncheckedUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.docDate !== undefined) {
      const date = parseDate(dto.docDate);
      if (!date) throw new BadRequestException('INVALID_DATE');
      data.docDate = date;
    }
    if (dto.data !== undefined) data.data = JSON.parse(JSON.stringify(dto.data));
    // the text changed: the generated files are stale
    data.docxKey = null;
    data.pdfKey = null;
    data.pdfSha256 = null;
    data.renderedAt = null;
    const updated = await this.prisma.document.update({ where: { id }, data });
    await this.removeKeys([d.docxKey, d.pdfKey]);
    await this.audit.log({ actorId: actor.id, action: 'document.updated', entityType: 'Document', entityId: id, data: { previousTitle: d.title, previousData: d.data as Prisma.InputJsonValue }, ip });
    return toDocumentDto(updated, { viewerId: actor.id, steps: d.steps });
  }

  /** The text or the approval sheet changed: the generated files no longer match. */
  async invalidateFiles(tx: Prisma.TransactionClient, doc: Pick<Document, 'id' | 'docxKey' | 'pdfKey'>) {
    await tx.document.update({ where: { id: doc.id }, data: { docxKey: null, pdfKey: null, pdfSha256: null, renderedAt: null } });
    return [doc.docxKey, doc.pdfKey];
  }

  async dropFiles(keys: (string | null)[]) {
    await this.removeKeys(keys);
  }

  private async removeKeys(keys: (string | null)[]) {
    await Promise.all(keys.filter((k): k is string => !!k).map((k) => this.storage.remove(k)));
  }

  private async read(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of this.storage.open(key)) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  }

  /** The approval sheet printed in the document: who approved or returned it, when, and what they wrote. */
  protected async approvalLines(doc: Document): Promise<RenderContext['approvals']> {
    const rows = await this.prisma.approvalAction.findMany({ where: { documentId: doc.id, kind: { in: ['APPROVE', 'RETURN'] } }, orderBy: { at: 'asc' }, include: { actor: { select: { fullName: true } } } });
    const words = doc.lang === 'kk' ? { APPROVE: 'келісті', RETURN: 'ескертулермен қайтарды' } : { APPROVE: 'согласовано', RETURN: 'возвращено с замечаниями' };
    const zone = process.env.APP_TIMEZONE || 'Asia/Almaty';
    const stamp = new Intl.DateTimeFormat('ru-RU', { timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return rows.map((r, i) => ({ n: i + 1, name: r.actor.fullName, result: words[r.kind as 'APPROVE' | 'RETURN'], at: stamp.format(r.at), comment: r.comment ?? '' }));
  }

  /** Makes the .docx (and the PDF when asked) if they are missing, and returns the stored keys. */
  async render(doc: Document & { kind: DocumentKind }, withPdf: boolean): Promise<{ docxKey: string; pdfKey: string | null; pdfSha256: string | null }> {
    let { docxKey, pdfKey, pdfSha256, templateId } = doc;
    if (!docxKey || !(await this.storage.exists(docxKey))) {
      const template = (templateId && (await this.prisma.documentTemplate.findUnique({ where: { id: templateId } }))) || (await this.templates.activeTemplate(doc.kindId, doc.lang));
      if (!template) throw new BadRequestException('NO_TEMPLATE');
      const author = await this.prisma.user.findUnique({ where: { id: doc.authorId }, select: { fullName: true } });
      let bytes: Buffer;
      try {
        bytes = renderDocx(
          await this.templates.readTemplate(template),
          buildContext({ org: orgName(doc.lang), title: doc.title, number: doc.registrationNumber, date: dateOnly(doc.docDate)!, author: author?.fullName ?? '', data: doc.data as DocData, approvals: await this.approvalLines(doc) }),
        );
      } catch (e) {
        if (e instanceof TemplateError) throw new BadRequestException({ message: 'TEMPLATE_INVALID', details: e.details });
        throw e;
      }
      docxKey = await this.storage.save(bytes);
      templateId = template.id;
      pdfKey = null;
      pdfSha256 = null;
      const won = await this.prisma.document.updateMany({ where: { id: doc.id, docxKey: doc.docxKey }, data: { docxKey, templateId, pdfKey: null, pdfSha256: null, renderedAt: new Date() } });
      if (won.count === 0) {
        // someone else rendered at the same moment: use their file
        await this.storage.remove(docxKey);
        const fresh = await this.prisma.document.findUniqueOrThrow({ where: { id: doc.id }, include: { kind: true } });
        return this.render(fresh, withPdf);
      }
      await this.removeKeys([doc.docxKey, doc.pdfKey]);
    }
    if (withPdf && (!pdfKey || !(await this.storage.exists(pdfKey)))) {
      const pdf = await this.pdf.toPdf(await this.read(docxKey));
      const newKey = await this.storage.save(pdf);
      const sha = createHash('sha256').update(pdf).digest('hex');
      const won = await this.prisma.document.updateMany({ where: { id: doc.id, docxKey, pdfKey: doc.pdfKey === pdfKey ? pdfKey : undefined }, data: { pdfKey: newKey, pdfSha256: sha } });
      if (won.count === 0) {
        await this.storage.remove(newKey);
        const fresh = await this.prisma.document.findUniqueOrThrow({ where: { id: doc.id }, include: { kind: true } });
        return this.render(fresh, withPdf);
      }
      await this.removeKeys([pdfKey]);
      pdfKey = newKey;
      pdfSha256 = sha;
    }
    return { docxKey, pdfKey, pdfSha256 };
  }

  /** The file for download, made on first request. */
  async file(id: string, actor: User, format: 'docx' | 'pdf') {
    const d = await this.load(id, actor);
    const full = await this.prisma.document.findUniqueOrThrow({ where: { id: d.id }, include: { kind: true } });
    const keys = await this.render(full, format === 'pdf');
    const key = format === 'pdf' ? keys.pdfKey! : keys.docxKey!;
    const base = sanitizeFileName(d.registrationNumber ? `${d.registrationNumber.replace(/\//g, '-')} ${d.title}` : d.title) || 'document';
    return {
      stream: this.storage.open(key),
      name: `${base}.${format}`,
      mime: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
}
