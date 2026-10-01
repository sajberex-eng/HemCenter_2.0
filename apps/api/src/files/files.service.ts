import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { AttachmentDto } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { FileStorage } from './file-storage';
import { hasBlockedExtension, maxUploadBytes, repairFileNameEncoding, sanitizeFileName, sniffImage } from './file-rules';

const ORPHAN_AGE_MS = 24 * 3600_000;

export const toAttachmentDto = (a: { id: string; name: string; mime: string; size: number }): AttachmentDto => ({
  id: a.id,
  name: a.name,
  mime: a.mime,
  size: a.size,
  isImage: a.mime.startsWith('image/'),
});

@Injectable()
export class FilesService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    // files that were uploaded but never sent do not pile up
    this.timer = setInterval(() => void this.cleanupOrphans().catch(() => undefined), 3600_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Same visibility rule as the chat itself: outsiders (administrators included) are told nothing exists. */
  private async requireMember(chatId: string, userId: string) {
    const m = await this.prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId } } });
    if (!m) throw new NotFoundException('ATTACHMENT_NOT_FOUND');
  }

  async upload(chatId: string, userId: string, file: Express.Multer.File | undefined, ip?: string): Promise<AttachmentDto> {
    const member = await this.prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId } } });
    if (!member) throw new NotFoundException('CHAT_NOT_FOUND');
    if (!file) throw new BadRequestException('FILE_REQUIRED');
    if (file.size === 0) throw new BadRequestException('EMPTY_FILE');
    if (file.size > maxUploadBytes()) throw new PayloadTooLargeException('FILE_TOO_LARGE');

    const name = sanitizeFileName(repairFileNameEncoding(file.originalname));
    if (hasBlockedExtension(name)) throw new BadRequestException('FILE_TYPE_NOT_ALLOWED');
    // The client's claimed type is ignored: only real raster images are ever shown inline.
    const mime = sniffImage(file.buffer) ?? 'application/octet-stream';
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    const storageKey = await this.storage.save(file.buffer);
    try {
      const a = await this.prisma.attachment.create({ data: { chatId, uploaderId: userId, name, mime, size: file.size, sha256, storageKey } });
      await this.audit.log({ actorId: userId, action: 'file.uploaded', entityType: 'Attachment', entityId: a.id, data: { chatId, name, size: file.size, sha256 }, ip });
      return toAttachmentDto(a);
    } catch (e) {
      await this.storage.remove(storageKey); // never leave bytes behind without a record
      throw e;
    }
  }

  /**
   * Opens a file for a chat member. Before it is sent, only the uploader can see it; once its message is
   * deleted, nobody can.
   */
  async open(id: string, userId: string) {
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    if (!a || a.deletedAt) throw new NotFoundException('ATTACHMENT_NOT_FOUND');
    await this.requireMember(a.chatId, userId);
    if (!a.messageId && a.uploaderId !== userId) throw new NotFoundException('ATTACHMENT_NOT_FOUND');
    // checked before any header is sent, so a file lost on disk becomes a clean 404 instead of a broken response
    if (!(await this.storage.exists(a.storageKey))) throw new NotFoundException('ATTACHMENT_NOT_FOUND');
    return { attachment: a, stream: this.storage.open(a.storageKey) };
  }

  /** The uploader withdraws a file that has not been sent yet. */
  async discard(id: string, userId: string, ip?: string) {
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    if (!a || a.deletedAt) throw new NotFoundException('ATTACHMENT_NOT_FOUND');
    if (a.uploaderId !== userId) throw new NotFoundException('ATTACHMENT_NOT_FOUND');
    if (a.messageId) throw new ForbiddenException('FORBIDDEN'); // sent files go away with their message
    await this.purge([a]);
    await this.audit.log({ actorId: userId, action: 'file.discarded', entityType: 'Attachment', entityId: id, ip });
  }

  /** Called when a message is deleted: the files go with it. Returns what was removed, for the audit trail. */
  async removeForMessage(messageId: string) {
    const files = await this.prisma.attachment.findMany({ where: { messageId, deletedAt: null } });
    await this.purge(files);
    return files.map((f) => ({ id: f.id, name: f.name, size: f.size, sha256: f.sha256 }));
  }

  async cleanupOrphans(olderThanMs = ORPHAN_AGE_MS): Promise<number> {
    const stale = await this.prisma.attachment.findMany({ where: { messageId: null, deletedAt: null, createdAt: { lt: new Date(Date.now() - olderThanMs) } } });
    await this.purge(stale);
    return stale.length;
  }

  /** Marks rows deleted and removes bytes. The row stays (name, size, hash) as an audit record. */
  private async purge(files: { id: string; storageKey: string }[]) {
    if (files.length === 0) return;
    await this.prisma.attachment.updateMany({ where: { id: { in: files.map((f) => f.id) } }, data: { deletedAt: new Date() } });
    await Promise.all(files.map((f) => this.storage.remove(f.storageKey).catch(() => undefined)));
  }
}
