import { INestApplication } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
import request from 'supertest';
import { ZipFile } from 'yazl';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importDir, ImportService } from '../src/import/import.service';
import { PrismaService } from '../src/prisma.service';
import { bearer, createApp, loginAs, makeUser, prisma, resetDb } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const ROOT = process.env.FILES_DIR!;

beforeAll(async () => {
  app = await createApp();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  await prisma.$executeRawUnsafe('TRUNCATE "ImportSession"');
  await fs.rm(ROOT, { recursive: true, force: true });
  await fs.mkdir(importDir(), { recursive: true });
});
afterEach(() => vi.restoreAllMocks());

// ---- fixtures -----------------------------------------------------------------------------------------------------
const TEXT = [
  '22.03.2024, 14:30 - Сообщения и звонки защищены сквозным шифрованием.',
  '22.03.2024, 14:31 - Иван Петров создал(а) группу «Бухгалтерия»',
  '22.03.2024, 14:36 - Иван Петров: Добрый день, коллеги!',
  'Прошу проверить реестр.',
  '22.03.2024, 14:40 - Айгерим Н.: Хорошо, сделаю',
  '23.03.2024, 09:05 - Айгерим Н.: <Медиа скрыто>',
  '23.03.2024, 18:00 - Гость Из Города: Привет всем',
].join('\n');

const zipOf = (files: Record<string, Buffer>): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const z = new ZipFile();
    for (const [n, b] of Object.entries(files)) z.addBuffer(b, n);
    z.end();
    const chunks: Buffer[] = [];
    z.outputStream.on('data', (c: Buffer) => chunks.push(c));
    z.outputStream.on('error', reject);
    z.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 3)]);

type P = { id: string; token: string };
async function person(login: string, roles: ('EMPLOYEE' | 'ADMIN')[] = ['EMPLOYEE'], extra: { fullName?: string; phone?: string } = {}): Promise<P> {
  const u = await makeUser(login, roles);
  if (extra.fullName || extra.phone) await prisma.user.update({ where: { id: u.id }, data: { fullName: extra.fullName ?? u.fullName, phone: extra.phone } });
  return { id: u.id, token: (await loginAs(app, login)).body.accessToken };
}
const upload = (p: P, data: Buffer | string, filename: string) => http().post('/api/import/whatsapp').set(bearer(p.token)).attach('file', Buffer.from(data), { filename });
const commit = (p: P, id: string, body: object) => http().post(`/api/import/whatsapp/${id}/commit`).set(bearer(p.token)).send(body);
const tmpFiles = async () => (await fs.readdir(importDir())).length;

async function staff() {
  const root = await person('root', ['ADMIN']);
  const ivan = await person('ivan', ['EMPLOYEE'], { fullName: 'Петров Иван Сергеевич' });
  const aigerim = await person('aigerim', ['EMPLOYEE'], { fullName: 'Касымова Айгерим Нурлановна' });
  const carl = await person('carl');
  return { root, ivan, aigerim, carl };
}

describe('preview', () => {
  it('reads the export and proposes who is who', async () => {
    const { root, ivan, aigerim } = await staff();
    const res = await upload(root, TEXT, 'Чат WhatsApp с Бухгалтерия.txt');
    expect(res.status).toBe(201);
    const v = res.body;
    expect(v.title).toBe('Бухгалтерия');
    expect(v.dateOrder).toBe('DMY');
    expect(v.counts).toMatchObject({ messages: 4, systemNotices: 2, omittedMedia: 1, files: 0 });
    // 14:36 on 22 March 2024 in Almaty (UTC+5) is 09:36 UTC
    expect(v.range).toEqual({ from: '2024-03-22T09:36:00.000Z', to: '2024-03-23T13:00:00.000Z' });
    const by = Object.fromEntries(v.authors.map((a: { name: string }) => [a.name, a]));
    expect(by['Иван Петров'].preselected).toBe(ivan.id);
    expect(by['Айгерим Н.'].preselected).toBe(aigerim.id);
    expect(by['Гость Из Города'].suggestions).toEqual([]);
    expect(by['Гость Из Города'].preselected).toBeNull();
    expect(v.sample.first[0]).toMatchObject({ author: 'Иван Петров', text: 'Добрый день, коллеги!\nПрошу проверить реестр.' });
  });

  it('says so when no date in the file settles day-first or month-first', async () => {
    const { root } = await staff();
    const ambiguous = (await upload(root, '03.04.2024, 10:00 - Иван: первое\n04.04.2024, 10:00 - Иван: второе', 'a.txt')).body;
    expect(ambiguous.dateOrderAmbiguous).toBe(true);
    const settled = (await upload(root, '22.03.2024, 10:00 - Иван: ясно\n04.04.2024, 10:00 - Иван: ещё', 'b.txt')).body;
    expect(settled.dateOrderAmbiguous).toBe(false); // the 22nd cannot be a month
  });
});

describe('importing', () => {
  async function importText(root: P, text: string, mapping: Record<string, string | null>, extra: object = {}) {
    const v = (await upload(root, text, 'Чат WhatsApp с Бухгалтерия.txt')).body;
    return commit(root, v.sessionId, { title: 'Бухгалтерия (архив)', mapping, ...extra });
  }

  it('creates a read-only archive for the mapped colleagues, with original times and outside names locked', async () => {
    const { root, ivan, aigerim, carl } = await staff();
    const res = await importText(root, TEXT, { 'Иван Петров': ivan.id, 'Айгерим Н.': aigerim.id, 'Гость Из Города': null });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ messages: 4, members: 2, outsiders: 1 });
    const chatId = res.body.chatId as string;

    const chat = await prisma.chat.findUniqueOrThrow({ where: { id: chatId }, include: { members: true } });
    expect(chat.type).toBe('ARCHIVE');
    expect(chat.members.map((m) => m.userId).sort()).toEqual([ivan.id, aigerim.id].sort());
    expect(chat.members.every((m) => m.lastReadSeq === 4)).toBe(true);

    const msgs = await prisma.message.findMany({ where: { chatId }, orderBy: { seq: 'asc' } });
    expect(msgs.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(msgs[0].createdAt.toISOString()).toBe('2024-03-22T09:36:00.000Z');
    expect(msgs[0].body).toBe('Добрый день, коллеги!\nПрошу проверить реестр.');
    expect(msgs[2].body).toContain('файл не включён в экспорт'); // omitted media is explained, not an empty bubble
    expect(msgs[3].authorId).not.toBe(ivan.id);

    // the guest has no account that works, and is not in the staff directory
    const guest = await prisma.user.findUniqueOrThrow({ where: { id: msgs[3].authorId } });
    expect(guest).toMatchObject({ isExternal: true, isActive: false, fullName: 'Гость Из Города' });
    expect((await loginAs(app, guest.login, 'anything-1234')).status).toBe(401);
    const dir = await http().get('/api/users?includeInactive=true').set(bearer(root.token));
    expect(dir.body.map((u: { fullName: string }) => u.fullName)).not.toContain('Гость Из Города');

    // members see it, with no unread counter; the importing administrator and others do not
    const list = await http().get('/api/chats').set(bearer(ivan.token));
    expect(list.body[0]).toMatchObject({ id: chatId, type: 'ARCHIVE', unreadCount: 0, title: 'Бухгалтерия (архив)' });
    expect((await http().get(`/api/chats/${chatId}/messages`).set(bearer(ivan.token))).body.messages).toHaveLength(4);
    expect((await http().get(`/api/chats/${chatId}/messages`).set(bearer(root.token))).status).toBe(404);
    expect((await http().get(`/api/chats/${chatId}/messages`).set(bearer(carl.token))).status).toBe(404);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'chat.imported' } });
    expect(audit!.data).toMatchObject({ source: 'whatsapp', messages: 4, outsiders: 1 });
  });

  it('the archive is read-only, but searchable', async () => {
    const { root, ivan, aigerim } = await staff();
    const chatId = (await importText(root, TEXT, { 'Иван Петров': ivan.id, 'Айгерим Н.': aigerim.id, 'Гость Из Города': null })).body.chatId as string;
    const msg = (await http().get(`/api/chats/${chatId}/messages`).set(bearer(ivan.token))).body.messages[0];

    const denied = async (r: request.Test) => {
      const res = await r;
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('CHAT_READ_ONLY');
    };
    await denied(http().post(`/api/chats/${chatId}/messages`).set(bearer(ivan.token)).send({ body: 'new' }));
    await denied(http().patch(`/api/chats/${chatId}/messages/${msg.id}`).set(bearer(ivan.token)).send({ body: 'edit' })); // Ivan wrote it, so only the archive rule stops him
    await denied(http().post(`/api/chats/${chatId}/pins`).set(bearer(ivan.token)).send({ messageId: msg.id }));
    await denied(http().post(`/api/chats/${chatId}/attachments`).set(bearer(ivan.token)).attach('file', Buffer.from('x'), { filename: 'a.txt' }));
    expect((await http().post(`/api/chats/${chatId}/members`).set(bearer(ivan.token)).send({ userIds: [aigerim.id] })).status).toBe(400);

    const found = await http().get(`/api/search/messages?q=${encodeURIComponent('реестр')}`).set(bearer(ivan.token));
    expect(found.body.hits).toHaveLength(1);
    expect((await http().get(`/api/search/messages?q=${encodeURIComponent('реестр')}`).set(bearer(root.token))).body.hits).toEqual([]);
  });

  it('refuses to import the same file twice', async () => {
    const { root, ivan } = await staff();
    const map = { 'Иван Петров': ivan.id, 'Айгерим Н.': null, 'Гость Из Города': null };
    expect((await importText(root, TEXT, map)).status).toBe(201);
    const again = await importText(root, TEXT, map);
    expect(again.status).toBe(409);
    expect(again.body.message).toBe('ALREADY_IMPORTED');
    expect(await prisma.chat.count({ where: { type: 'ARCHIVE' } })).toBe(1);
  });

  it('validates the mapping before creating anything', async () => {
    const { root, ivan } = await staff();
    const v = (await upload(root, TEXT, 'x.txt')).body;
    const full = { 'Иван Петров': ivan.id, 'Айгерим Н.': null, 'Гость Из Города': null };
    const bad = async (mapping: object, code: string, status = 400) => {
      const r = await commit(root, v.sessionId, { title: 'T', mapping });
      expect([r.status, r.body.message], JSON.stringify(mapping)).toEqual([status, code]);
    };
    await bad({ 'Иван Петров': ivan.id }, 'IMPORT_MAPPING_INCOMPLETE'); // a name was left out
    await bad({ ...full, 'Иван Петров': '00000000-0000-4000-8000-000000000000' }, 'USER_NOT_FOUND');
    await bad({ ...full, 'Иван Петров': 'not-a-uuid' }, 'IMPORT_MAPPING_INVALID');
    await bad({ ...full, 'Иван Петров': 5 }, 'IMPORT_MAPPING_INVALID');
    await bad({ 'Иван Петров': null, 'Айгерим Н.': null, 'Гость Из Города': null }, 'IMPORT_NEEDS_MEMBERS');
    expect((await commit(root, v.sessionId, { title: ' ', mapping: full })).status).toBe(400);
    expect((await commit(root, v.sessionId, { title: 'T', mapping: full, timeZone: 'Mars/Base' })).body.message).toBe('INVALID_TIMEZONE');
    // nothing was created by the failed attempts, and the session is still usable
    expect(await prisma.chat.count()).toBe(0);
    expect(await prisma.user.count({ where: { isExternal: true } })).toBe(0);
    expect((await commit(root, v.sessionId, { title: 'T', mapping: full })).status).toBe(201);
  });

  it('cannot attribute messages to a blocked or outside account', async () => {
    const { root, ivan } = await staff();
    await prisma.user.update({ where: { id: ivan.id }, data: { isActive: false } });
    const v = (await upload(root, TEXT, 'x.txt')).body;
    const res = await commit(root, v.sessionId, { title: 'T', mapping: { 'Иван Петров': ivan.id, 'Айгерим Н.': null, 'Гость Из Города': null } });
    expect(res.body.message).toBe('USER_NOT_FOUND');
  });

  it('honours the date order and time zone chosen by the administrator', async () => {
    const { root, ivan } = await staff();
    const text = '03.04.2024, 10:00 - Иван Петров: сообщение';
    const v = (await upload(root, text, 'x.txt')).body;
    expect(v.dateOrderAmbiguous).toBe(true);
    expect(v.range.from).toBe('2024-04-03T05:00:00.000Z'); // 3 April, Almaty UTC+5
    const flipped = (await http().get(`/api/import/whatsapp/${v.sessionId}?order=MDY&tz=UTC`).set(bearer(root.token))).body;
    expect(flipped.range.from).toBe('2024-03-04T10:00:00.000Z'); // 4 March, UTC
    const res = await commit(root, v.sessionId, { title: 'T', mapping: { 'Иван Петров': ivan.id }, dateOrder: 'MDY', timeZone: 'UTC' });
    const m = await prisma.message.findFirstOrThrow({ where: { chatId: res.body.chatId } });
    expect(m.createdAt.toISOString()).toBe('2024-03-04T10:00:00.000Z');
  });

  it('sorts messages chronologically even if the file is not', async () => {
    const { root, ivan } = await staff();
    const text = '24.03.2024, 10:00 - Иван Петров: позже\n22.03.2024, 10:00 - Иван Петров: раньше';
    const res = await importText(root, text, { 'Иван Петров': ivan.id });
    const msgs = await prisma.message.findMany({ where: { chatId: res.body.chatId }, orderBy: { seq: 'asc' } });
    expect(msgs.map((m) => m.body)).toEqual(['раньше', 'позже']);
  });

  it('imports a large history in reasonable time', async () => {
    const { root, ivan } = await staff();
    const big = Array.from({ length: 20_000 }, (_, i) => `22.03.2024, 14:${String(i % 60).padStart(2, '0')} - Иван Петров: сообщение ${i}`).join('\n');
    const t = Date.now();
    const res = await importText(root, big, { 'Иван Петров': ivan.id });
    expect(res.status).toBe(201);
    expect(Date.now() - t).toBeLessThan(20_000);
    expect(await prisma.message.count({ where: { chatId: res.body.chatId } })).toBe(20_000);
  }, 60_000);
});

describe('archives with files', () => {
  const chatText = [
    '22.03.2024, 14:36 - Иван Петров: IMG-20240322-WA0001.jpg (файл добавлен)',
    'Скан договора',
    '22.03.2024, 14:37 - Иван Петров: Реестр.XLSX (файл добавлен)',
    '22.03.2024, 14:38 - Иван Петров: virus.exe (файл добавлен)',
    '22.03.2024, 14:39 - Иван Петров: потерянный.pdf (файл добавлен)',
    '22.03.2024, 14:40 - Иван Петров: HUGE.dat (файл добавлен)',
  ].join('\n');

  it('imports the files that are safe and present, and explains the rest', async () => {
    const { root, ivan } = await staff();
    const zip = await zipOf({
      'Чат WhatsApp с Бухгалтерия.txt': Buffer.from(chatText),
      'IMG-20240322-WA0001.jpg': PNG,
      'реестр.xlsx': Buffer.from('rows'), // different letter case from the chat text
      'virus.exe': Buffer.from('MZ'),
    });
    const v = (await upload(root, zip, 'Чат WhatsApp с Бухгалтерия.zip')).body;
    expect(v.counts).toMatchObject({ files: 5, filesFound: 2, filesBlocked: 1, filesMissing: 2 });
    const res = await commit(root, v.sessionId, { title: 'Архив', mapping: { 'Иван Петров': ivan.id } });
    expect(res.body).toMatchObject({ messages: 5, files: 2 });

    const msgs = (await http().get(`/api/chats/${res.body.chatId}/messages`).set(bearer(ivan.token))).body.messages;
    expect(msgs[0].attachments[0]).toMatchObject({ name: 'IMG-20240322-WA0001.jpg', mime: 'image/png', isImage: true });
    expect(msgs[0].body).toBe('Скан договора');
    expect(msgs[1].attachments[0].name).toBe('Реестр.XLSX');
    expect(msgs[2].attachments).toEqual([]);
    expect(msgs[2].body).toContain('вложение отсутствует'); // blocked type: skipped and said so
    expect(msgs[3].body).toContain('потерянный.pdf'); // not in the archive

    // a member downloads the very bytes; outsiders cannot
    const down = await http().get(`/api/attachments/${msgs[0].attachments[0].id}`).set(bearer(ivan.token)).buffer(true).parse((r, cb) => {
      const c: Buffer[] = [];
      r.on('data', (d) => c.push(d));
      r.on('end', () => cb(null, Buffer.concat(c)));
    });
    expect(Buffer.from(down.body).equals(PNG)).toBe(true);
    expect((await http().get(`/api/attachments/${msgs[0].attachments[0].id}`).set(bearer(root.token))).status).toBe(404);
    expect(await prisma.attachment.count({ where: { name: 'virus.exe' } })).toBe(0);
  });

  it('does not expand a decompression bomb or an oversized file', async () => {
    const { root, ivan } = await staff();
    process.env.MAX_UPLOAD_MB = '1';
    try {
      const zip = await zipOf({ 'chat.txt': Buffer.from(chatText), 'HUGE.dat': Buffer.alloc(60 * 1024 * 1024), 'IMG-20240322-WA0001.jpg': Buffer.alloc(2 * 1024 * 1024, 5) });
      const v = (await upload(root, zip, 'x.zip')).body;
      const res = await commit(root, v.sessionId, { title: 'Архив', mapping: { 'Иван Петров': ivan.id } });
      expect(res.status).toBe(201);
      expect(res.body.files).toBe(0); // the zero-filled bomb and the 2 MB file above the 1 MB limit were both skipped
      expect(await prisma.attachment.count()).toBe(0);
    } finally {
      delete process.env.MAX_UPLOAD_MB;
    }
  }, 60_000);

  it('removes stored bytes again if the database step fails', async () => {
    const { root, ivan } = await staff();
    const zip = await zipOf({ 'chat.txt': Buffer.from(chatText), 'IMG-20240322-WA0001.jpg': PNG });
    const v = (await upload(root, zip, 'x.zip')).body;
    vi.spyOn(app.get(PrismaService), '$transaction').mockRejectedValueOnce(new Error('database went away'));
    const res = await commit(root, v.sessionId, { title: 'Архив', mapping: { 'Иван Петров': ivan.id } });
    expect(res.status).toBe(500);
    const left = (await fs.readdir(ROOT, { recursive: true })).filter((f) => !String(f).startsWith('imports'));
    expect(left.filter((f) => /[0-9a-f-]{36}$/.test(String(f)))).toEqual([]);
    expect(await prisma.chat.count()).toBe(0);
    // the session survives, so the administrator can simply try again
    expect((await commit(root, v.sessionId, { title: 'Архив', mapping: { 'Иван Петров': ivan.id } })).status).toBe(201);
  });
});

describe('access and cleanup', () => {
  it('is for administrators only, and one administrator cannot touch another\'s upload', async () => {
    const { root, ivan } = await staff();
    const other = await person('root2', ['ADMIN']);
    expect((await upload(ivan, TEXT, 'x.txt')).status).toBe(403);
    expect((await http().post('/api/import/whatsapp')).status).toBe(401);
    const v = (await upload(root, TEXT, 'x.txt')).body;
    expect((await http().get(`/api/import/whatsapp/${v.sessionId}`).set(bearer(other.token))).status).toBe(404);
    expect((await commit(other, v.sessionId, { title: 'T', mapping: { 'Иван Петров': ivan.id, 'Айгерим Н.': null, 'Гость Из Города': null } })).status).toBe(404);
    expect((await http().delete(`/api/import/whatsapp/${v.sessionId}`).set(bearer(other.token))).status).toBe(404);
    expect((await http().get(`/api/import/whatsapp/${v.sessionId}`).set(bearer(root.token))).status).toBe(200);
  });

  it('unusable files leave nothing behind', async () => {
    const { root } = await staff();
    expect((await upload(root, 'hello', 'virus.exe')).body.message).toBe('IMPORT_FILE_TYPE');
    expect((await upload(root, '', 'empty.txt')).status).toBe(400);
    expect((await upload(root, 'просто текст без дат', 'chat.txt')).body.message).toBe('IMPORT_EMPTY');
    expect((await upload(root, 'PK\x03\x04 broken archive content', 'broken.zip')).body.message).toBe('IMPORT_BAD_ARCHIVE');
    const noText = await zipOf({ 'photo.jpg': PNG });
    expect((await upload(root, noText, 'notext.zip')).body.message).toBe('IMPORT_NO_TEXT');
    expect(await tmpFiles()).toBe(0);
    expect(await prisma.importSession.count()).toBe(0);
  });

  it('discarding or expiring a session deletes the uploaded file', async () => {
    const { root } = await staff();
    const a = (await upload(root, TEXT, 'a.txt')).body;
    const b = (await upload(root, TEXT + '\n24.03.2024, 10:00 - Иван Петров: ещё', 'b.txt')).body;
    expect(await tmpFiles()).toBe(2);
    await http().delete(`/api/import/whatsapp/${a.sessionId}`).set(bearer(root.token)).expect(204);
    expect(await tmpFiles()).toBe(1);
    await prisma.importSession.update({ where: { id: b.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await http().get(`/api/import/whatsapp/${b.sessionId}`).set(bearer(root.token))).status).toBe(404); // expired means gone
    expect(await app.get(ImportService).cleanupExpired()).toBe(1);
    expect(await tmpFiles()).toBe(0);
  });
});
