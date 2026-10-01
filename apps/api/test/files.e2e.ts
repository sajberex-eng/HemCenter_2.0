import { INestApplication } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FilesService } from '../src/files/files.service';
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
  await fs.rm(ROOT, { recursive: true, force: true });
  await fs.mkdir(ROOT, { recursive: true });
});
afterEach(() => {
  delete process.env.MAX_UPLOAD_MB;
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

type Person = { id: string; token: string };

async function setup() {
  const sign = async (login: string): Promise<Person> => {
    const u = await makeUser(login);
    return { id: u.id, token: (await loginAs(app, login)).body.accessToken };
  };
  const anna = await sign('anna');
  const boris = await sign('boris');
  const carl = await sign('carl');
  const chat = (await http().post('/api/chats/direct').set(bearer(anna.token)).send({ userId: boris.id })).body;
  return { anna, boris, carl, chat };
}

const upload = (token: string, chatId: string, data: Buffer, filename: string, contentType?: string) =>
  http().post(`/api/chats/${chatId}/attachments`).set(bearer(token)).attach('file', data, { filename, contentType });

const filesOnDisk = async (dir = ROOT): Promise<string[]> => {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await filesOnDisk(p)));
    else out.push(p);
  }
  return out;
};

describe('upload and download', () => {
  it('a member sends a file; the other member downloads identical bytes as an attachment', async () => {
    const { anna, boris, chat } = await setup();
    const content = Buffer.from('Протокол совещания №1\n'.repeat(50));
    const up = await upload(anna.token, chat.id, content, 'Протокол.docx');
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ name: 'Протокол.docx', size: content.length, mime: 'application/octet-stream', isImage: false });

    const msg = await http().post(`/api/chats/${chat.id}/messages`).set(bearer(anna.token)).send({ attachmentIds: [up.body.id] });
    expect(msg.status).toBe(201);
    expect(msg.body.attachments).toHaveLength(1);

    const down = await http().get(`/api/attachments/${up.body.id}`).set(bearer(boris.token)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(down.status).toBe(200);
    expect(Buffer.from(down.body).equals(content)).toBe(true);
    expect(down.headers['content-type']).toContain('application/octet-stream');
    expect(down.headers['content-disposition']).toMatch(/^attachment;/);
    expect(down.headers['x-content-type-options']).toBe('nosniff');
    expect(down.headers['content-security-policy']).toContain('sandbox');
    expect(decodeURIComponent(down.headers['content-disposition'].split("UTF-8''")[1])).toBe('Протокол.docx');
  });

  it('keeps Cyrillic and Kazakh file names intact', async () => {
    const { anna, chat } = await setup();
    for (const name of ['Приказ №15.docx', 'Құжат үлгісі.pdf']) {
      const up = await upload(anna.token, chat.id, Buffer.from('x'), name);
      expect(up.body.name).toBe(name);
    }
  });

  it('shows real images inline and refuses to trust the declared type', async () => {
    const { anna, boris, chat } = await setup();
    const img = await upload(anna.token, chat.id, PNG, 'scan.png', 'image/png');
    expect(img.body).toMatchObject({ mime: 'image/png', isImage: true });
    await http().post(`/api/chats/${chat.id}/messages`).set(bearer(anna.token)).send({ attachmentIds: [img.body.id] });
    const shown = await http().get(`/api/attachments/${img.body.id}`).set(bearer(boris.token));
    expect(shown.headers['content-type']).toBe('image/png');
    expect(shown.headers['content-disposition']).toMatch(/^inline;/);

    // HTML disguised as a picture: named .png, declared image/png, but not an image
    const fake = await upload(anna.token, chat.id, Buffer.from('<html><script>alert(1)</script></html>'), 'photo.png', 'image/png');
    expect(fake.status).toBe(201);
    expect(fake.body).toMatchObject({ mime: 'application/octet-stream', isImage: false });
    await http().post(`/api/chats/${chat.id}/messages`).set(bearer(anna.token)).send({ attachmentIds: [fake.body.id] });
    const dl = await http().get(`/api/attachments/${fake.body.id}`).set(bearer(boris.token));
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['content-type']).toContain('application/octet-stream');
  });

  it('rejects programs, scripts and web pages, including double extensions', async () => {
    const { anna, chat } = await setup();
    for (const name of ['setup.exe', 'report.pdf.exe', 'run.bat', 'x.ps1', 'page.html', 'logo.svg', 'a.js']) {
      const res = await upload(anna.token, chat.id, Buffer.from('data'), name);
      expect(res.status, name).toBe(400);
      expect(res.body.message).toBe('FILE_TYPE_NOT_ALLOWED');
    }
    expect(await filesOnDisk()).toEqual([]);
    expect(await prisma.attachment.count()).toBe(0);
  });

  it('enforces the size limit and refuses empty files', async () => {
    const { anna, chat } = await setup();
    process.env.MAX_UPLOAD_MB = '1';
    const big = await upload(anna.token, chat.id, Buffer.alloc(1024 * 1024 + 1, 7), 'big.dat');
    expect(big.status).toBe(413);
    expect((await upload(anna.token, chat.id, Buffer.alloc(1024 * 1024, 7), 'ok.dat')).status).toBe(201);
    expect((await upload(anna.token, chat.id, Buffer.alloc(0), 'empty.txt')).status).toBe(400);
    expect(await filesOnDisk()).toHaveLength(1);
  });

  it('a hostile file name never reaches the disk path', async () => {
    const { anna, chat } = await setup();
    const up = await upload(anna.token, chat.id, Buffer.from('x'), '../../../../tmp/evil.txt');
    expect(up.status).toBe(201);
    expect(up.body.name).toBe('evil.txt');
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: up.body.id } });
    expect(row.storageKey).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
    const files = await filesOnDisk();
    expect(files).toHaveLength(1);
    expect(files[0].startsWith(ROOT)).toBe(true);
    expect(files[0]).not.toContain('evil');
  });
});

describe('who can see files', () => {
  it('outsiders, administrators and anonymous callers get nothing', async () => {
    const { anna, carl, chat } = await setup();
    await makeUser('root', ['ADMIN']);
    const admin = (await loginAs(app, 'root')).body.accessToken;
    const up = await upload(anna.token, chat.id, Buffer.from('secret'), 'secret.txt');
    await http().post(`/api/chats/${chat.id}/messages`).set(bearer(anna.token)).send({ attachmentIds: [up.body.id] });

    expect((await http().get(`/api/attachments/${up.body.id}`).set(bearer(carl.token))).status).toBe(404);
    expect((await http().get(`/api/attachments/${up.body.id}`).set(bearer(admin))).status).toBe(404);
    expect((await http().get(`/api/attachments/${up.body.id}`)).status).toBe(401);
    expect((await upload(carl.token, chat.id, Buffer.from('x'), 'x.txt')).status).toBe(404);
  });

  it('an unsent file is private to its uploader', async () => {
    const { anna, boris, chat } = await setup();
    const up = await upload(anna.token, chat.id, Buffer.from('draft'), 'draft.txt');
    expect((await http().get(`/api/attachments/${up.body.id}`).set(bearer(anna.token))).status).toBe(200);
    expect((await http().get(`/api/attachments/${up.body.id}`).set(bearer(boris.token))).status).toBe(404);
  });

  it('a removed group member can no longer download earlier files', async () => {
    const { anna, boris, carl } = await setup();
    const g = (await http().post('/api/chats/groups').set(bearer(anna.token)).send({ title: 'Team', memberIds: [boris.id, carl.id] })).body;
    const up = await upload(anna.token, g.id, Buffer.from('x'), 'a.txt');
    await http().post(`/api/chats/${g.id}/messages`).set(bearer(anna.token)).send({ attachmentIds: [up.body.id] });
    expect((await http().get(`/api/attachments/${up.body.id}`).set(bearer(carl.token))).status).toBe(200);
    await http().delete(`/api/chats/${g.id}/members/${carl.id}`).set(bearer(anna.token)).expect(204);
    expect((await http().get(`/api/attachments/${up.body.id}`).set(bearer(carl.token))).status).toBe(404);
  });
});

describe('attaching to messages', () => {
  const send = (token: string, chatId: string, body: object) => http().post(`/api/chats/${chatId}/messages`).set(bearer(token)).send(body);

  it('allows a file-only message but not an empty one', async () => {
    const { anna, chat } = await setup();
    const up = await upload(anna.token, chat.id, Buffer.from('x'), 'a.txt');
    const ok = await send(anna.token, chat.id, { attachmentIds: [up.body.id] });
    expect(ok.status).toBe(201);
    expect(ok.body.body).toBe('');
    expect((await send(anna.token, chat.id, { body: '  ' })).status).toBe(400);
    expect((await send(anna.token, chat.id, { attachmentIds: [] })).status).toBe(400);
  });

  it('refuses files that belong to someone else or to another chat', async () => {
    const { anna, boris, carl, chat } = await setup();
    const other = (await http().post('/api/chats/direct').set(bearer(anna.token)).send({ userId: carl.id })).body;
    const mine = await upload(anna.token, chat.id, Buffer.from('x'), 'a.txt');
    const elsewhere = await upload(anna.token, other.id, Buffer.from('x'), 'b.txt');

    expect((await send(boris.token, chat.id, { body: 'stolen', attachmentIds: [mine.body.id] })).status).toBe(400);
    expect((await send(anna.token, chat.id, { body: 'wrong chat', attachmentIds: [elsewhere.body.id] })).status).toBe(400);
    expect((await send(anna.token, chat.id, { body: 'nonexistent', attachmentIds: ['00000000-0000-4000-8000-000000000000'] })).status).toBe(400);
    // nothing was claimed by the failed attempts
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: mine.body.id } })).messageId).toBeNull();
    expect(await prisma.message.count()).toBe(0);
  });

  it('one file can be sent only once, even when two sends race', async () => {
    const { anna, chat } = await setup();
    const up = await upload(anna.token, chat.id, Buffer.from('x'), 'a.txt');
    const [a, b] = await Promise.all([
      send(anna.token, chat.id, { body: 'first', attachmentIds: [up.body.id] }),
      send(anna.token, chat.id, { body: 'second', attachmentIds: [up.body.id] }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect(await prisma.message.count()).toBe(1); // the losing message was rolled back completely
  });

  it('limits files per message', async () => {
    const { anna, chat } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) ids.push((await upload(anna.token, chat.id, Buffer.from(`f${i}`), `f${i}.txt`)).body.id);
    expect((await send(anna.token, chat.id, { attachmentIds: ids })).status).toBe(400);
    expect((await send(anna.token, chat.id, { attachmentIds: ids.slice(0, 10) })).status).toBe(201);
  });
});

describe('removing files', () => {
  it('deleting a message removes its files from disk and keeps an audit record', async () => {
    const { anna, boris, chat } = await setup();
    const up = await upload(anna.token, chat.id, Buffer.from('to be removed'), 'oops.txt');
    const msg = (await http().post(`/api/chats/${chat.id}/messages`).set(bearer(anna.token)).send({ body: 'see file', attachmentIds: [up.body.id] })).body;
    expect(await filesOnDisk()).toHaveLength(1);

    const del = await http().delete(`/api/chats/${chat.id}/messages/${msg.id}`).set(bearer(anna.token));
    expect(del.body.attachments).toEqual([]);
    expect(await filesOnDisk()).toEqual([]);
    expect((await http().get(`/api/attachments/${up.body.id}`).set(bearer(boris.token))).status).toBe(404);
    const history = (await http().get(`/api/chats/${chat.id}/messages`).set(bearer(boris.token))).body.messages;
    expect(history[0].attachments).toEqual([]);

    const entry = await prisma.auditLog.findFirst({ where: { action: 'message.deleted' } });
    expect((entry!.data as { removedFiles: { name: string }[] }).removedFiles[0].name).toBe('oops.txt');
  });

  it('the uploader can withdraw an unsent file, but not a sent one', async () => {
    const { anna, chat } = await setup();
    const draft = await upload(anna.token, chat.id, Buffer.from('x'), 'draft.txt');
    await http().delete(`/api/attachments/${draft.body.id}`).set(bearer(anna.token)).expect(204);
    expect(await filesOnDisk()).toEqual([]);

    const sent = await upload(anna.token, chat.id, Buffer.from('y'), 'sent.txt');
    await http().post(`/api/chats/${chat.id}/messages`).set(bearer(anna.token)).send({ attachmentIds: [sent.body.id] });
    expect((await http().delete(`/api/attachments/${sent.body.id}`).set(bearer(anna.token))).status).toBe(403);
  });

  it('files that were never sent are cleaned up after a day, sent ones stay', async () => {
    const { anna, chat } = await setup();
    const orphan = await upload(anna.token, chat.id, Buffer.from('forgotten'), 'orphan.txt');
    const kept = await upload(anna.token, chat.id, Buffer.from('kept'), 'kept.txt');
    await http().post(`/api/chats/${chat.id}/messages`).set(bearer(anna.token)).send({ attachmentIds: [kept.body.id] });
    await prisma.attachment.updateMany({ data: { createdAt: new Date(Date.now() - 2 * 24 * 3600_000) } });

    expect(await app.get(FilesService).cleanupOrphans()).toBe(1);
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: orphan.body.id } })).deletedAt).not.toBeNull();
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: kept.body.id } })).deletedAt).toBeNull();
    expect(await filesOnDisk()).toHaveLength(1);
  });

  it('a file lost on disk gives a clean 404 without leaking a path', async () => {
    const { anna, boris, chat } = await setup();
    const up = await upload(anna.token, chat.id, Buffer.from('x'), 'a.txt');
    await http().post(`/api/chats/${chat.id}/messages`).set(bearer(anna.token)).send({ attachmentIds: [up.body.id] });
    for (const f of await filesOnDisk()) await fs.rm(f);
    const res = await http().get(`/api/attachments/${up.body.id}`).set(bearer(boris.token));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(ROOT);
  });
});
