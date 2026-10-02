import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Document, DocumentKind, Prisma, User } from '@prisma/client';
import { EDITABLE_DOCUMENT_STATUSES, type DocData, type DocumentDto } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { FileStorage } from '../files/file-storage';
import { sanitizeFileName } from '../files/file-rules';
import { parseDate, todayIn, dateOnly } from '../projects/project-rules';
import { KindsTemplatesService } from './kinds-templates.service';
import { PdfConverter } from './pdf-converter';
import { buildContext, renderDocx, TemplateError } from './render';
import type { CreateDocumentDto, UpdateDocumentDto } from './dto';

/** Roles that see every document (the secretary keeps the registers, management oversees). */
const SEES_ALL = ['SECRETARY', 'ADMIN', 'MANAGEMENT'] as const;
export const seesAllDocuments = (u: Pick<User, 'roles'>) => u.roles.some((r) => (SEES_ALL as readonly string[]).includes(r));

export const toDocumentDto = (d: Document): DocumentDto => ({
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

  /** Who may see a document. Approvers are added to this rule together with the approval flow. */
  protected canSee(d: Pick<Document, 'authorId'>, u: User) {
    return d.authorId === u.id || seesAllDocuments(u);
  }

  async load(id: string, u: User) {
    const d = await this.prisma.document.findUnique({ where: { id } });
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
    return toDocumentDto(doc);
  }

  async list(actor: User, q: { status?: string; kindId?: string; mine?: boolean }) {
    const where: Prisma.DocumentWhereInput = {};
    if (q.status) where.status = q.status as Document['status'];
    if (q.kindId) where.kindId = q.kindId;
    if (q.mine || !seesAllDocuments(actor)) where.authorId = actor.id;
    const rows = await this.prisma.document.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200 });
    return rows.map(toDocumentDto);
  }

  async get(id: string, actor: User) {
    return toDocumentDto(await this.load(id, actor));
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
    return toDocumentDto(updated);
  }

  private async removeKeys(keys: (string | null)[]) {
    await Promise.all(keys.filter((k): k is string => !!k).map((k) => this.storage.remove(k)));
  }

  private async read(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of this.storage.open(key)) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  }

  /** Extra lines for the approval sheet; the approval flow fills this in. */
  protected async approvalLines(_doc: Document): Promise<{ n: number; name: string; result: string; at: string; comment: string }[]> {
    return [];
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
