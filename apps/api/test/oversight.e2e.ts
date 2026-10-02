import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createApp, loginAs, makeUser, prisma, resetDb } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createApp();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(resetDb);

async function person(login: string, roles: ('ADMIN' | 'EMPLOYEE' | 'MANAGEMENT')[] = ['EMPLOYEE']) {
  const u = await makeUser(login, roles);
  return { id: u.id, token: (await loginAs(app, login)).body.accessToken as string };
}

/** Anna and Boris talk; the director is not in their chat. */
async function scene() {
  const anna = await person('anna');
  const boris = await person('boris');
  const director = await person('director', ['MANAGEMENT']);
  const admin = await person('root', ['ADMIN']);
  const chat = (await http().post('/api/chats/direct').set(bearer(anna.token)).send({ userId: boris.id })).body;
  await http().post(`/api/chats/${chat.id}/messages`).set(bearer(anna.token)).send({ body: 'Секретная закупка' }).expect(201);
  await http().post(`/api/chats/${chat.id}/messages`).set(bearer(boris.token)).send({ body: 'Принял' }).expect(201);
  return { anna, boris, director, admin, chat };
}

const oversightActions = async () => (await prisma.auditLog.findMany({ where: { action: { startsWith: 'oversight.' } }, orderBy: { id: 'asc' } }));

describe('management view', () => {
  it('lets management read a chat it is not a member of, and logs every step', async () => {
    const { director, chat, anna } = await scene();
    const list = await http().get('/api/oversight/chats').set(bearer(director.token));
    expect(list.status).toBe(200);
    expect(list.body.map((c: { id: string }) => c.id)).toContain(chat.id);

    expect((await http().get(`/api/oversight/chats/${chat.id}`).set(bearer(director.token))).body.members).toHaveLength(2);
    const msgs = await http().get(`/api/oversight/chats/${chat.id}/messages`).set(bearer(director.token));
    expect(msgs.status).toBe(200);
    expect(msgs.body.messages.map((m: { body: string }) => m.body)).toEqual(['Секретная закупка', 'Принял']);

    const log = await oversightActions();
    expect(log.map((l) => l.action)).toEqual(['oversight.chats_listed', 'oversight.chat_opened', 'oversight.messages_read']);
    expect(log.every((l) => l.actorId === director.id)).toBe(true);
    expect(log[2].data).toMatchObject({ chatId: chat.id, count: 2, fromSeq: 1, toSeq: 2 });

    // reading did not touch anyone's read state or unread counter
    const mine = await http().get('/api/chats').set(bearer(anna.token));
    expect(mine.body[0].members.find((m: { userId: string }) => m.userId === anna.id).lastReadSeq).toBe(0);
  });

  it('is closed to everyone without the role, administrators included', async () => {
    const { anna, admin, chat } = await scene();
    for (const who of [anna, admin]) {
      expect((await http().get('/api/oversight/chats').set(bearer(who.token))).status).toBe(403);
      expect((await http().get(`/api/oversight/chats/${chat.id}/messages`).set(bearer(who.token))).status).toBe(403);
    }
    expect((await http().get('/api/oversight/chats')).status).toBe(401);
    expect(await oversightActions()).toHaveLength(0);
  });

  it('does not loosen the ordinary endpoints: management is still a stranger there', async () => {
    const { director, chat } = await scene();
    expect((await http().get(`/api/chats/${chat.id}`).set(bearer(director.token))).status).toBe(404);
    expect((await http().get(`/api/chats/${chat.id}/messages`).set(bearer(director.token))).status).toBe(404);
    expect((await http().post(`/api/chats/${chat.id}/messages`).set(bearer(director.token)).send({ body: 'привет' })).status).toBe(404);
    expect((await http().get('/api/chats').set(bearer(director.token))).body).toEqual([]);
  });

  it('is read-only: there is no way to write through it', async () => {
    const { director, chat } = await scene();
    expect((await http().post(`/api/oversight/chats/${chat.id}/messages`).set(bearer(director.token)).send({ body: 'x' })).status).toBe(404);
    expect((await http().delete(`/api/oversight/chats/${chat.id}`).set(bearer(director.token))).status).toBe(404);
  });

  it('searches by chat title and by member name', async () => {
    const { director, anna, boris } = await scene();
    await http().post('/api/chats/groups').set(bearer(anna.token)).send({ title: 'Закупки', memberIds: [boris.id] }).expect(201);
    const byTitle = await http().get('/api/oversight/chats').query({ q: 'закуп' }).set(bearer(director.token));
    expect(byTitle.body.map((c: { title: string }) => c.title)).toEqual(['Закупки']);
    const byName = await http().get('/api/oversight/chats').query({ q: 'User anna' }).set(bearer(director.token));
    expect(byName.body).toHaveLength(2);
    expect((await http().get('/api/oversight/chats').query({ q: 'нет такого' }).set(bearer(director.token))).body).toEqual([]);
  });

  it('serves attachments through the audited route only', async () => {
    const { director, anna, boris, chat } = await scene();
    const up = await http().post(`/api/chats/${chat.id}/attachments`).set(bearer(anna.token)).attach('file', Buffer.from('отчёт'), { filename: 'report.txt', contentType: 'text/plain' });
    expect(up.status).toBe(201);
    // not sent yet: hidden even from management
    expect((await http().get(`/api/oversight/attachments/${up.body.id}`).set(bearer(director.token))).status).toBe(404);
    await http().post(`/api/chats/${chat.id}/messages`).set(bearer(anna.token)).send({ attachmentIds: [up.body.id] }).expect(201);

    const got = await http().get(`/api/oversight/attachments/${up.body.id}`).set(bearer(director.token)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(got.status).toBe(200);
    expect((got.body as Buffer).toString()).toBe('отчёт');
    expect(got.headers['cache-control']).toBe('no-store');
    expect((await oversightActions()).map((l) => l.action)).toContain('oversight.file_opened');
    // the ordinary download route still refuses a stranger
    expect((await http().get(`/api/attachments/${up.body.id}`).set(bearer(director.token))).status).toBe(404);
    expect(boris.id).toBeTruthy();
  });

  it('lets the members of a chat see how often management opened it, and nobody else', async () => {
    const { director, anna, boris, chat } = await scene();
    const views = (token: string) => http().get(`/api/chats/${chat.id}/oversight`).set(bearer(token));
    expect((await views(anna.token)).body).toEqual({ count: 0, lastAt: null });

    await http().get(`/api/oversight/chats/${chat.id}`).set(bearer(director.token));
    await http().get(`/api/oversight/chats/${chat.id}`).set(bearer(director.token));
    // listing and reading pages are not "openings"
    await http().get(`/api/oversight/chats/${chat.id}/messages`).set(bearer(director.token));
    const seen = (await views(boris.token)).body;
    expect(seen.count).toBe(2);
    expect(new Date(seen.lastAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    // it does not say who looked
    expect(Object.keys(seen).sort()).toEqual(['count', 'lastAt']);

    expect((await views(director.token)).status).toBe(404); // a non-member gets nothing here either
  });

  it('answers 404 for an unknown chat', async () => {
    const { director } = await scene();
    expect((await http().get('/api/oversight/chats/00000000-0000-4000-8000-000000000000').set(bearer(director.token))).status).toBe(404);
  });
});
