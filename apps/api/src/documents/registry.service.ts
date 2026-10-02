import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { FileStorage } from '../files/file-storage';
import { maxUploadBytes, repairFileNameEncoding, sanitizeFileName, sniffImage } from '../files/file-rules';
import { todayIn } from '../projects/project-rules';
import { DocumentsService } from './documents.service';
import { AssignmentsService } from '../assignments/assignments.service';
import type { Assignment } from '@prisma/client';
import { lockDocument } from './approval.service';
import { formatRegistrationNumber } from './approval-rules';

const isSecretary = (u: Pick<User, 'roles'>) => u.roles.includes('SECRETARY') || u.roles.includes('ADMIN');

/** A scan is a PDF or a photo (PNG/JPEG); the type is decided by the bytes, not by what the browser claims. */
export function sniffScan(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  const img = sniffImage(buf);
  if (img === 'image/png') return { mime: img, ext: 'png' };
  if (img === 'image/jpeg') return { mime: img, ext: 'jpg' };
  return null;
}

@Injectable()
export class RegistryService {
  private readonly log = new Logger('Registry');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly storage: FileStorage,
    private readonly documents: DocumentsService,
    private readonly assignments: AssignmentsService,
  ) {}

  private async notify(documentId: string) {
    const d = await this.prisma.document.findUnique({ where: { id: documentId }, select: { authorId: true, steps: { select: { approverId: true } } } });
    if (d) this.realtime.emit([...new Set([d.authorId, ...d.steps.map((s) => s.approverId)])], 'document:updated', { documentId });
  }

  /** The signed paper copy, scanned. The author or the secretary attaches it once the document is approved. */
  async uploadScan(actor: User, id: string, file: Express.Multer.File | undefined, ip?: string) {
    const doc = await this.documents.load(id, actor);
    if (doc.authorId !== actor.id && !isSecretary(actor)) throw new ForbiddenException('FORBIDDEN');
    if (!file) throw new BadRequestException('FILE_REQUIRED');
    if (file.size === 0) throw new BadRequestException('EMPTY_FILE');
    if (file.size > maxUploadBytes()) throw new PayloadTooLargeException('FILE_TOO_LARGE');
    const type = sniffScan(file.buffer);
    if (!type) throw new BadRequestException('SCAN_TYPE_NOT_ALLOWED');
    const name = sanitizeFileName(repairFileNameEncoding(file.originalname)) || `scan.${type.ext}`;

    const key = await this.storage.save(file.buffer);
    let previous: string | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockDocument(tx, id);
        const cur = await tx.document.findUniqueOrThrow({ where: { id } });
        if (cur.status !== 'APPROVED' && cur.status !== 'SIGNED') throw new BadRequestException('NOT_READY_FOR_SCAN');
        previous = cur.scanKey;
        await tx.document.update({
          where: { id },
          data: { status: 'SIGNED', scanKey: key, scanName: name, scanMime: type.mime, scanSize: file.size, scanSha256: createHash('sha256').update(file.buffer).digest('hex'), scanAt: new Date() },
        });
        await tx.approvalAction.create({ data: { documentId: id, round: cur.round, actorId: actor.id, kind: 'SCAN', comment: name } });
      });
    } catch (e) {
      await this.storage.remove(key);
      throw e;
    }
    if (previous) await this.storage.remove(previous);
    await this.audit.log({ actorId: actor.id, action: 'document.scan_uploaded', entityType: 'Document', entityId: id, data: { name, size: file.size }, ip });
    await this.notify(id);
    return this.documents.get(id, actor);
  }

  async openScan(actor: User, id: string) {
    const doc = await this.documents.load(id, actor);
    if (!doc.scanKey || !(await this.storage.exists(doc.scanKey))) throw new NotFoundException('SCAN_NOT_FOUND');
    return { stream: this.storage.open(doc.scanKey), name: doc.scanName ?? 'scan', mime: doc.scanMime ?? 'application/octet-stream' };
  }

  /**
   * Gives the document its number. The counter row of the kind and year is locked while the next number is taken, so
   * two registrations at the same moment get consecutive numbers, and a document can be registered only once.
   */
  async register(actor: User, id: string, ip?: string) {
    if (!isSecretary(actor)) throw new ForbiddenException('FORBIDDEN');
    await this.documents.load(id, actor);
    const year = Number(todayIn().slice(0, 4));
    const result = await this.prisma.$transaction(async (tx) => {
      await lockDocument(tx, id);
      const cur = await tx.document.findUniqueOrThrow({ where: { id }, include: { kind: true } });
      if (cur.status === 'REGISTERED') throw new ConflictException('ALREADY_REGISTERED');
      if (cur.status !== 'SIGNED') throw new BadRequestException('NOT_READY_FOR_REGISTRATION');
      await tx.$executeRaw`INSERT INTO "RegistryCounter" ("kindId", "year", "last") VALUES (${cur.kindId}, ${year}, 0) ON CONFLICT DO NOTHING`;
      // the UPDATE takes the counter row's lock itself: concurrent registrations queue here and get consecutive numbers
      const counter = await tx.registryCounter.update({ where: { kindId_year: { kindId: cur.kindId, year } }, data: { last: { increment: 1 } } });
      const number = formatRegistrationNumber(counter.last, cur.kind.prefix, year);
      await tx.document.update({ where: { id }, data: { status: 'REGISTERED', registrationNumber: number, registeredAt: new Date(), registeredById: actor.id } });
      await tx.approvalAction.create({ data: { documentId: id, round: cur.round, actorId: actor.id, kind: 'REGISTER', comment: number } });
      // the items that name a person and a date become tracked assignments, or the registration does not happen at all
      const created = await this.assignments.createForDocument(tx, cur, actor);
      return { number, created, old: await this.documents.invalidateFiles(tx, cur) }; // the number goes into the files
    });
    await this.documents.dropFiles(result.old);
    await this.assignments.announce(result.created as Assignment[]);
    await this.audit.log({ actorId: actor.id, action: 'document.registered', entityType: 'Document', entityId: id, data: { number: result.number, assignments: result.created.length }, ip });
    // fix the final PDF (and its hash) right away; if the converter is down, the first download makes it
    try {
      await this.documents.render(await this.prisma.document.findUniqueOrThrow({ where: { id }, include: { kind: true } }), true);
    } catch (e) {
      this.log.warn(`final PDF of ${id} not made yet: ${(e as Error).message}`);
    }
    await this.notify(id);
    return this.documents.get(id, actor);
  }
}
