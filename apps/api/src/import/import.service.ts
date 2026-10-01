import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, PayloadTooLargeException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { FileStorage } from '../files/file-storage';
import { hasBlockedExtension, maxUploadBytes, repairFileNameEncoding, sanitizeFileName, sniffImage } from '../files/file-rules';
import { hashPassword, randomToken } from '../common/password';
import { confidentChoice, isKnownTimeZone, PLACEHOLDER_OMITTED, placeholderMissing, suggestUsers, titleFromFileName, type Suggestion } from './import-rules';
import { parseWhatsApp, type DateOrder, type ParsedMessage, type ParseResult } from './whatsapp-parser';
import { SafeZip, type ZipEntryInfo } from './zip-reader';
import { zonedToUtc } from './time';

const SESSION_TTL_MS = 24 * 3600_000;
const MAX_TEXT_BYTES = 50 * 1024 * 1024;
const MAX_MESSAGES = 200_000;
const MAX_AUTHORS = 300;
const BATCH = 1000;

export const importDir = () => path.join(path.resolve(process.env.FILES_DIR ?? './data/files'), 'imports');
export const defaultTimeZone = () => process.env.APP_TIMEZONE ?? 'Asia/Almaty';

interface Source {
  parsed: ParseResult;
  zip: SafeZip | null;
}

export interface Preview {
  sessionId: string;
  fileName: string;
  title: string;
  dateOrder: DateOrder;
  dateOrderAmbiguous: boolean;
  timeZone: string;
  counts: { messages: number; systemNotices: number; skippedLines: number; files: number; filesFound: number; filesMissing: number; filesBlocked: number; omittedMedia: number };
  range: { from: string; to: string } | null;
  authors: { name: string; count: number; suggestions: Suggestion[]; preselected: string | null }[];
  sample: { first: SampleLine[]; last: SampleLine[] };
}
interface SampleLine {
  at: string;
  author: string;
  text: string;
}

export interface CommitInput {
  title: string;
  /** WhatsApp display name -> user id, or null to keep the person as an outside participant. */
  mapping: Record<string, string | null>;
  dateOrder?: DateOrder;
  timeZone?: string;
}

@Injectable()
export class ImportService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ImportService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly storage: FileStorage,
  ) {}

  async onModuleInit() {
    await fs.mkdir(importDir(), { recursive: true });
    this.timer = setInterval(() => void this.cleanupExpired().catch(() => undefined), 3600_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---- upload ---------------------------------------------------------------------------------------------------
  /** Registers an uploaded file (already on disk in the import folder). Deletes it again if it is unusable. */
  async createSession(adminId: string, file: { path: string; originalname: string; size: number } | undefined): Promise<string> {
    if (!file) throw new BadRequestException('FILE_REQUIRED');
    try {
      if (file.size === 0) throw new BadRequestException('EMPTY_FILE');
      if (!/\.(zip|txt)$/i.test(file.originalname)) throw new BadRequestException('IMPORT_FILE_TYPE');
      const sha256 = await hashFile(file.path);
      const session = await this.prisma.importSession.create({
        data: { createdById: adminId, filePath: file.path, originalName: sanitizeFileName(repairFileNameEncoding(file.originalname)), sha256, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      });
      return session.id;
    } catch (e) {
      await fs.rm(file.path, { force: true });
      throw e;
    }
  }

  private async session(id: string, adminId: string) {
    const s = await this.prisma.importSession.findUnique({ where: { id } });
    // another administrator's upload is as good as nonexistent
    if (!s || s.createdById !== adminId || s.expiresAt < new Date()) throw new NotFoundException('IMPORT_SESSION_NOT_FOUND');
    return s;
  }

  async discard(id: string, adminId: string) {
    const s = await this.session(id, adminId);
    await this.removeSession(s);
  }

  private async removeSession(s: { id: string; filePath: string }) {
    await fs.rm(s.filePath, { force: true });
    await this.prisma.importSession.deleteMany({ where: { id: s.id } });
  }

  async cleanupExpired(): Promise<number> {
    const stale = await this.prisma.importSession.findMany({ where: { expiresAt: { lt: new Date() } } });
    for (const s of stale) await this.removeSession(s);
    return stale.length;
  }

  // ---- reading the export ---------------------------------------------------------------------------------------
  private async open(filePath: string, hint?: DateOrder): Promise<Source> {
    const head = Buffer.alloc(4);
    const fh = await fs.open(filePath, 'r');
    try {
      await fh.read(head, 0, 4, 0);
    } finally {
      await fh.close();
    }
    const isZip = head[0] === 0x50 && head[1] === 0x4b; // "PK": decided by content, not by the file name
    let text: Buffer;
    let zip: SafeZip | null = null;
    if (isZip) {
      zip = await SafeZip.open(filePath);
      try {
        const texts = zip.entries.filter((e) => /\.txt$/i.test(e.base)).sort((a, b) => b.size - a.size);
        if (texts.length === 0) throw new BadRequestException('IMPORT_NO_TEXT');
        const raw = await zip.read(texts[0], MAX_TEXT_BYTES);
        if (!raw) throw new PayloadTooLargeException('IMPORT_TEXT_TOO_LARGE');
        text = raw;
      } catch (e) {
        zip.close();
        throw e;
      }
    } else {
      if ((await fs.stat(filePath)).size > MAX_TEXT_BYTES) throw new PayloadTooLargeException('IMPORT_TEXT_TOO_LARGE');
      text = await fs.readFile(filePath);
    }
    const parsed = parseWhatsApp(new TextDecoder('utf-8').decode(text), hint);
    return { parsed, zip };
  }

  /** Finds the exported file for a name mentioned in the chat: exact first, then ignoring case. */
  private findEntry(zip: SafeZip | null, name: string): ZipEntryInfo | null {
    if (!zip) return null;
    return zip.entries.find((e) => e.base === name) ?? zip.entries.find((e) => e.base.toLowerCase() === name.toLowerCase()) ?? null;
  }

  // ---- preview --------------------------------------------------------------------------------------------------
  async preview(id: string, adminId: string, opts: { order?: DateOrder; timeZone?: string } = {}): Promise<Preview> {
    const s = await this.session(id, adminId);
    const timeZone = opts.timeZone && isKnownTimeZone(opts.timeZone) ? opts.timeZone : defaultTimeZone();
    const { parsed, zip } = await this.open(s.filePath, opts.order);
    try {
      const talk = parsed.messages.filter((m) => m.author !== null);
      if (talk.length === 0) throw new BadRequestException('IMPORT_EMPTY');
      if (talk.length > MAX_MESSAGES) throw new PayloadTooLargeException('IMPORT_TOO_LARGE');

      const byAuthor = new Map<string, number>();
      for (const m of talk) byAuthor.set(m.author!, (byAuthor.get(m.author!) ?? 0) + 1);
      if (byAuthor.size > MAX_AUTHORS) throw new BadRequestException('IMPORT_TOO_MANY_AUTHORS');

      const users = await this.prisma.user.findMany({ where: { isActive: true, isExternal: false }, select: { id: true, fullName: true, phone: true } });
      const authors = [...byAuthor.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => {
          const suggestions = suggestUsers(name, users);
          return { name, count, suggestions, preselected: confidentChoice(suggestions)?.userId ?? null };
        });

      let files = 0, filesFound = 0, filesBlocked = 0, omittedMedia = 0;
      for (const m of talk) {
        if (m.omittedMedia) omittedMedia++;
        if (!m.file) continue;
        files++;
        if (hasBlockedExtension(m.file)) filesBlocked++;
        else if (this.findEntry(zip, m.file)) filesFound++;
      }

      const at = (m: ParsedMessage) => zonedToUtc(m.local, timeZone);
      const sorted = [...talk].sort((a, b) => at(a).getTime() - at(b).getTime());
      const line = (m: ParsedMessage): SampleLine => ({ at: at(m).toISOString(), author: m.author!, text: (m.text || (m.file ? `📎 ${m.file}` : '')).slice(0, 200) });
      return {
        sessionId: s.id,
        fileName: s.originalName,
        title: titleFromFileName(s.originalName),
        dateOrder: parsed.order,
        dateOrderAmbiguous: parsed.orderAmbiguous,
        timeZone,
        counts: { messages: talk.length, systemNotices: parsed.messages.length - talk.length, skippedLines: parsed.skippedLines, files, filesFound, filesMissing: files - filesFound - filesBlocked, filesBlocked, omittedMedia },
        range: { from: at(sorted[0]).toISOString(), to: at(sorted[sorted.length - 1]).toISOString() },
        authors,
        sample: { first: sorted.slice(0, 5).map(line), last: sorted.slice(-5).map(line) },
      };
    } finally {
      zip?.close();
    }
  }

  // ---- import ---------------------------------------------------------------------------------------------------
  /** Gives every WhatsApp name an account to attribute its messages to: a colleague, or a locked "outside" placeholder. */
  private async resolveAuthors(names: string[], mapping: Record<string, string | null>): Promise<{ ids: Map<string, string>; realUsers: Set<string> }> {
    const mapped = Object.values(mapping).filter((v): v is string => !!v);
    // checked before anything is created: nobody could ever read an archive without a single real member
    if (mapped.length === 0) throw new BadRequestException('IMPORT_NEEDS_MEMBERS');
    if (mapped.length) {
      const ok = await this.prisma.user.count({ where: { id: { in: [...new Set(mapped)] }, isActive: true, isExternal: false } });
      if (ok !== new Set(mapped).size) throw new BadRequestException('USER_NOT_FOUND');
    }
    const ids = new Map<string, string>();
    const realUsers = new Set<string>();
    for (const name of names) {
      if (!(name in mapping)) throw new BadRequestException('IMPORT_MAPPING_INCOMPLETE');
      const userId = mapping[name];
      if (userId) {
        ids.set(name, userId);
        realUsers.add(userId);
      } else {
        const login = `wa-${createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0, 16)}`;
        const existing = await this.prisma.user.findUnique({ where: { login } });
        const ext =
          existing ??
          (await this.prisma.user.create({
            data: { login, passwordHash: await hashPassword(randomToken()), fullName: name.slice(0, 200), roles: [], isActive: false, isExternal: true, mustChangePassword: false },
          }));
        ids.set(name, ext.id);
      }
    }
    return { ids, realUsers };
  }

  async commit(id: string, adminId: string, input: CommitInput, ip?: string) {
    const s = await this.session(id, adminId);
    const title = input.title.trim();
    if (!title || title.length > 100) throw new BadRequestException('INVALID_TITLE');
    const timeZone = input.timeZone ?? defaultTimeZone();
    if (!isKnownTimeZone(timeZone)) throw new BadRequestException('INVALID_TIMEZONE');
    if (await this.prisma.chat.findUnique({ where: { importHash: s.sha256 }, select: { id: true } })) throw new ConflictException('ALREADY_IMPORTED');

    const { parsed, zip } = await this.open(s.filePath, input.dateOrder);
    const savedKeys: string[] = [];
    try {
      const talk = parsed.messages.filter((m) => m.author !== null);
      if (talk.length === 0) throw new BadRequestException('IMPORT_EMPTY');
      if (talk.length > MAX_MESSAGES) throw new PayloadTooLargeException('IMPORT_TOO_LARGE');

      const names = [...new Set(talk.map((m) => m.author!))];
      const { ids, realUsers } = await this.resolveAuthors(names, input.mapping);

      // chronological order, ties keep the file order (Array.sort is stable)
      const ordered = talk.map((m) => ({ m, at: zonedToUtc(m.local, timeZone) })).sort((a, b) => a.at.getTime() - b.at.getTime());

      // files first: bytes on disk, rows later (a failure removes the bytes again)
      type Stored = { key: string; name: string; mime: string; size: number; sha256: string };
      const stored = new Map<number, Stored>();
      const maxFile = maxUploadBytes();
      let filesImported = 0, filesSkipped = 0;
      for (let i = 0; i < ordered.length; i++) {
        const name = ordered[i].m.file;
        if (!name) continue;
        const entry = this.findEntry(zip, name);
        const fileName = sanitizeFileName(name);
        if (!entry || !zip || hasBlockedExtension(fileName) || zip.isSuspicious(entry) || entry.size === 0) {
          filesSkipped++;
          continue;
        }
        const data = await zip.read(entry, maxFile);
        if (!data || data.length === 0) {
          filesSkipped++;
          continue;
        }
        const key = await this.storage.save(data);
        savedKeys.push(key);
        stored.set(i, { key, name: fileName, mime: sniffImage(data) ?? 'application/octet-stream', size: data.length, sha256: createHash('sha256').update(data).digest('hex') });
        filesImported++;
      }

      const total = ordered.length;
      const chatId = randomUUID();
      await this.prisma.$transaction(
        async (tx) => {
          await tx.chat.create({
            data: {
              id: chatId,
              type: 'ARCHIVE',
              title,
              createdById: adminId,
              importHash: s.sha256,
              importedAt: new Date(),
              importedById: adminId,
              lastSeq: total,
              lastMessageAt: ordered[total - 1].at,
              // history is already "read": it must not show up as hundreds of unread messages
              members: { create: [...realUsers].map((userId) => ({ userId, role: 'MEMBER' as const, lastReadSeq: total })) },
            },
          });
          const messageIds: string[] = ordered.map(() => randomUUID());
          for (let from = 0; from < total; from += BATCH) {
            await tx.message.createMany({
              data: ordered.slice(from, from + BATCH).map(({ m, at }, k) => {
                const i = from + k;
                let body = m.text;
                if (m.omittedMedia) body = PLACEHOLDER_OMITTED;
                else if (m.file && !stored.has(i)) body = [body, placeholderMissing(sanitizeFileName(m.file))].filter(Boolean).join('\n');
                return { id: messageIds[i], chatId, seq: i + 1, authorId: ids.get(m.author!)!, body, createdAt: at, mentionIds: [] };
              }),
            });
          }
          const rows = [...stored.entries()].map(([i, f]) => ({
            id: randomUUID(), chatId, uploaderId: ids.get(ordered[i].m.author!)!, messageId: messageIds[i], name: f.name, mime: f.mime, size: f.size, sha256: f.sha256, storageKey: f.key,
          }));
          for (let from = 0; from < rows.length; from += BATCH) await tx.attachment.createMany({ data: rows.slice(from, from + BATCH) });
        },
        { timeout: 300_000, maxWait: 10_000 },
      );

      await this.removeSession(s);
      await this.audit.log({
        actorId: adminId,
        action: 'chat.imported',
        entityType: 'Chat',
        entityId: chatId,
        data: { source: 'whatsapp', messages: total, files: filesImported, filesSkipped, authors: names.length, outsiders: names.length - realUsers.size, dateOrder: parsed.order, timeZone, sha256: s.sha256 },
        ip,
      });
      this.realtime.emit([...realUsers], 'chat:updated', { chatId });
      return { chatId, messages: total, files: filesImported, filesSkipped, members: realUsers.size, outsiders: names.length - realUsers.size };
    } catch (e) {
      // nothing half-imported stays behind
      await Promise.all(savedKeys.map((k) => this.storage.remove(k).catch(() => undefined)));
      throw e;
    } finally {
      zip?.close();
    }
  }
}

function hashFile(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(p).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}
