import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import type { DocumentKind, DocumentTemplate, User } from '@prisma/client';
import { LOCALES, type DocumentKindDto, type DocumentTemplateDto, type Locale } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { FileStorage } from '../files/file-storage';
import { DEFAULT_KINDS, buildDefaultTemplate } from './default-templates';
import { TemplateError, validateTemplate } from './render';
import type { CreateKindDto, UpdateKindDto } from './dto';

export const toKindDto = (k: DocumentKind): DocumentKindDto => ({ id: k.id, code: k.code, nameRu: k.nameRu, nameKk: k.nameKk, prefix: k.prefix, isActive: k.isActive });
export const toTemplateDto = (t: DocumentTemplate): DocumentTemplateDto => ({
  id: t.id,
  kindId: t.kindId,
  lang: t.lang,
  version: t.version,
  name: t.name,
  isActive: t.isActive,
  createdAt: t.createdAt.toISOString(),
});

export const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024;

@Injectable()
export class KindsTemplatesService implements OnModuleInit {
  private readonly log = new Logger('DocumentDefaults');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
  ) {}

  async onModuleInit() {
    try {
      await this.ensureDefaults();
    } catch (e) {
      this.log.error(`could not create the built-in document kinds: ${(e as Error).message}`);
    }
  }

  /** Creates the built-in kinds and their first templates (ru and kk) when they are missing. Safe to run any time. */
  async ensureDefaults() {
    for (const d of DEFAULT_KINDS) {
      const kind = await this.prisma.documentKind.upsert({ where: { code: d.code }, update: {}, create: { code: d.code, nameRu: d.nameRu, nameKk: d.nameKk, prefix: d.prefix } });
      for (const lang of LOCALES) {
        if (await this.prisma.documentTemplate.count({ where: { kindId: kind.id, lang } })) continue;
        const bytes = buildDefaultTemplate(d.code, lang);
        const fileKey = await this.storage.save(bytes);
        try {
          await this.prisma.documentTemplate.create({
            data: { kindId: kind.id, lang, version: 1, name: `${lang === 'ru' ? d.nameRu : d.nameKk} (${lang})`, fileKey, sha256: createHash('sha256').update(bytes).digest('hex') },
          });
        } catch {
          await this.storage.remove(fileKey); // another instance created it first
        }
      }
    }
  }

  // ---- kinds ----
  async listKinds(all: boolean) {
    const rows = await this.prisma.documentKind.findMany({ where: all ? {} : { isActive: true }, orderBy: { createdAt: 'asc' } });
    return rows.map(toKindDto);
  }

  async createKind(actor: User, dto: CreateKindDto, ip?: string) {
    const kind = await this.prisma.documentKind.create({ data: { nameRu: dto.nameRu.trim(), nameKk: dto.nameKk.trim(), prefix: dto.prefix } });
    await this.audit.log({ actorId: actor.id, action: 'document_kind.created', entityType: 'DocumentKind', entityId: kind.id, data: { nameRu: kind.nameRu, prefix: kind.prefix }, ip });
    return toKindDto(kind);
  }

  async updateKind(actor: User, id: string, dto: UpdateKindDto, ip?: string) {
    const kind = await this.prisma.documentKind.findUnique({ where: { id } });
    if (!kind) throw new NotFoundException('KIND_NOT_FOUND');
    // a prefix already printed on registered documents must not change under them
    if (dto.prefix !== undefined && dto.prefix !== kind.prefix && (await this.prisma.document.count({ where: { kindId: id, registrationNumber: { not: null } } })) > 0) {
      throw new ConflictException('PREFIX_LOCKED');
    }
    const updated = await this.prisma.documentKind.update({
      where: { id },
      data: { nameRu: dto.nameRu?.trim(), nameKk: dto.nameKk?.trim(), prefix: dto.prefix, isActive: dto.isActive },
    });
    await this.audit.log({ actorId: actor.id, action: 'document_kind.updated', entityType: 'DocumentKind', entityId: id, data: JSON.parse(JSON.stringify(dto)), ip });
    return toKindDto(updated);
  }

  // ---- templates ----
  async listTemplates(kindId?: string) {
    const rows = await this.prisma.documentTemplate.findMany({ where: { kindId }, orderBy: [{ kindId: 'asc' }, { lang: 'asc' }, { version: 'desc' }] });
    return rows.map(toTemplateDto);
  }

  /** The newest active template for a kind and language. */
  activeTemplate(kindId: string, lang: Locale) {
    return this.prisma.documentTemplate.findFirst({ where: { kindId, lang, isActive: true }, orderBy: { version: 'desc' } });
  }

  async readTemplate(t: Pick<DocumentTemplate, 'fileKey'>): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of this.storage.open(t.fileKey)) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  }

  /** The secretary uploads a Word file; it becomes the next version of that kind and language. */
  async upload(actor: User, kindId: string, lang: Locale, file: Express.Multer.File | undefined, ip?: string) {
    if (!file) throw new BadRequestException('FILE_REQUIRED');
    if (file.size > MAX_TEMPLATE_BYTES) throw new BadRequestException('TEMPLATE_TOO_LARGE');
    const kind = await this.prisma.documentKind.findUnique({ where: { id: kindId } });
    if (!kind) throw new NotFoundException('KIND_NOT_FOUND');
    try {
      validateTemplate(file.buffer, lang);
    } catch (e) {
      if (e instanceof TemplateError) throw new BadRequestException({ message: 'TEMPLATE_INVALID', details: e.details });
      throw e;
    }
    const fileKey = await this.storage.save(file.buffer);
    try {
      const last = await this.prisma.documentTemplate.findFirst({ where: { kindId, lang }, orderBy: { version: 'desc' } });
      const t = await this.prisma.documentTemplate.create({
        data: {
          kindId,
          lang,
          version: (last?.version ?? 0) + 1,
          name: file.originalname.slice(0, 200),
          fileKey,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          uploadedById: actor.id,
        },
      });
      await this.audit.log({ actorId: actor.id, action: 'document_template.uploaded', entityType: 'DocumentTemplate', entityId: t.id, data: { kindId, lang, version: t.version, sha256: t.sha256 }, ip });
      return toTemplateDto(t);
    } catch (e) {
      await this.storage.remove(fileKey);
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('TEMPLATE_VERSION_CONFLICT'); // two uploads at once
      throw e;
    }
  }

  async openTemplate(id: string) {
    const t = await this.prisma.documentTemplate.findUnique({ where: { id } });
    if (!t || !(await this.storage.exists(t.fileKey))) throw new NotFoundException('TEMPLATE_NOT_FOUND');
    return { template: t, stream: this.storage.open(t.fileKey) };
  }
}
