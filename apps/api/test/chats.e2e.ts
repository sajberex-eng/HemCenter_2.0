import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RealtimeService } from '../src/realtime/realtime.service';
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

/** Creates users and signs them in. Returns { id, token } per login. */
async function people(...logins: string[]) {
  const out: Record<string, { id: string; token: string }> = {};
  for (const login of logins) {
    const u = await makeUser(login);
    out[login] = { id: u.id, token: (await loginAs(app, login)).body.accessToken };
  }
  return out;
}

const direct = (token: string, userId: string) => http().post('/api/chats/direct').set(bearer(token)).send({ userId });
const group = (token: string, title: string, memberIds: string[]) => http().post('/api/chats/groups').set(bearer(token)).send({ title, memberIds });
const send = (token: string, chatId: string, body: string, extra: object = {}) =>
  http().post(`/api/chats/${chatId}/messages`).set(bearer(token)).send({ body, ...extra });

describe('direct chats', () => {
  it('is one chat per pair, whoever opens it', async () => {
    const { anna, boris } = await people('anna', 'boris');
    const a = await direct(anna.token, boris.id);
    const b = await direct(boris.token, anna.id);
    expect(a.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect((await direct(anna.token, boris.id)).body.id).toBe(a.body.id);
    expect(await prisma.chat.count()).toBe(1);
  });

  it('survives two people opening it at the same moment', async () => {
    const { anna, boris } = await people('anna', 'boris');
    const [a, b] = await Promise.all([direct(anna.token, boris.id), direct(boris.token, anna.id)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.id).toBe(b.body.id);
    expect(await prisma.chat.count()).toBe(1);
  });

  it('refuses chatting with yourself, unknown or blocked people', async () => {
    const { anna, boris } = await people('anna', 'boris');
    expect((await direct(anna.token, anna.id)).status).toBe(400);
    expect((await direct(anna.token, '00000000-0000-4000-8000-000000000000')).status).toBe(400);
    await prisma.user.update({ where: { id: boris.id }, data: { isActive: false } });
    expect((await direct(anna.token, boris.id)).status).toBe(400);
  });
});

describe('access control', () => {
  it('hides chats from non-members: reading, writing and listing', async () => {
    const { anna, boris, carl } = await people('anna', 'boris', 'carl');
    const chat = (await direct(anna.token, boris.id)).body;
    await send(anna.token, chat.id, 'private');

    expect((await http().get(`/api/chats/${chat.id}`).set(bearer(carl.token))).status).toBe(404);
    expect((await http().get(`/api/chats/${chat.id}/messages`).set(bearer(carl.token))).status).toBe(404);
    expect((await send(carl.token, chat.id, 'intruder')).status).toBe(404);
    expect((await http().post(`/api/chats/${chat.id}/read`).set(bearer(carl.token)).send({ seq: 1 })).status).toBe(404);
    expect((await http().get('/api/chats').set(bearer(carl.token))).body).toEqual([]);
    expect(await prisma.message.count()).toBe(1);
  });

  it('even an administrator cannot read other people\'s chats through the API', async () => {
    const { anna, boris } = await people('anna', 'boris');
    await makeUser('root', ['ADMIN']);
    const admin = (await loginAs(app, 'root')).body.accessToken;
    const chat = (await direct(anna.token, boris.id)).body;
    expect((await http().get(`/api/chats/${chat.id}/messages`).set(bearer(admin))).status).toBe(404);
  });

  it('requires a signed-in user', async () => {
    expect((await http().get('/api/chats')).status).toBe(401);
  });
});

describe('messages', () => {
  it('numbers messages without gaps even when sent concurrently', async () => {
    const { anna, boris } = await people('anna', 'boris');
    const chat = (await direct(anna.token, boris.id)).body;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => send(i % 2 ? anna.token : boris.token, chat.id, `m${i}`)),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const seqs = results.map((r) => r.body.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('pages through history from the newest to the oldest', async () => {
    const { anna, boris } = await people('anna', 'boris');
    const chat = (await direct(anna.token, boris.id)).body;
    for (let i = 1; i <= 7; i++) await send(anna.token, chat.id, `m${i}`);

    const first = await http().get(`/api/chats/${chat.id}/messages?limit=3`).set(bearer(boris.token));
    expect(first.body.messages.map((m: { body: string }) => m.body)).toEqual(['m5', 'm6', 'm7']);
    expect(first.body.hasMore).toBe(true);
    const second = await http().get(`/api/chats/${chat.id}/messages?limit=3&before=5`).set(bearer(boris.token));
    expect(second.body.messages.map((m: { body: string }) => m.body)).toEqual(['m2', 'm3', 'm4']);
    const last = await http().get(`/api/chats/${chat.id}/messages?limit=3&before=2`).set(bearer(boris.token));
    expect(last.body.messages.map((m: { body: string }) => m.body)).toEqual(['m1']);
    expect(last.body.hasMore).toBe(false);
  });

  it('validates text length, replies and mentions', async () => {
    const { anna, boris, carl } = await people('anna', 'boris', 'carl');
    const chat = (await direct(anna.token, boris.id)).body;
    const other = (await direct(anna.token, carl.id)).body;

    expect((await send(anna.token, chat.id, '   ')).status).toBe(400);
    expect((await send(anna.token, chat.id, 'x'.repeat(4001))).status).toBe(400);
    expect((await send(anna.token, chat.id, 'x'.repeat(4000))).status).toBe(201);

    const foreign = (await send(anna.token, other.id, 'in another chat')).body;
    expect((await send(anna.token, chat.id, 'reply', { replyToId: foreign.id })).status).toBe(400);
    expect((await send(anna.token, chat.id, 'hi', { mentionIds: [carl.id] })).status).toBe(400); // carl is not in this chat

    const original = (await send(boris.token, chat.id, 'original')).body;
    const reply = await send(anna.token, chat.id, 'answer @boris', { replyToId: original.id, mentionIds: [boris.id] });
    expect(reply.status).toBe(201);
    expect(reply.body.replyTo).toMatchObject({ id: original.id, body: 'original' });
    expect(reply.body.mentionIds).toEqual([boris.id]);
  });
});

describe('unread counters and read receipts', () => {
  it('counts only other people\'s messages and clears when read', async () => {
    const { anna, boris } = await people('anna', 'boris');
    const chat = (await direct(anna.token, boris.id)).body;
    await send(anna.token, chat.id, 'one');
    await send(anna.token, chat.id, 'two');
    await send(boris.token, chat.id, 'own message');

    const forBoris = (await http().get('/api/chats').set(bearer(boris.token))).body[0];
    expect(forBoris.unreadCount).toBe(2);
    expect(forBoris.lastMessage.body).toBe('own message');
    expect((await http().get('/api/chats').set(bearer(anna.token))).body[0].unreadCount).toBe(1);

    const read = await http().post(`/api/chats/${chat.id}/read`).set(bearer(boris.token)).send({ seq: 2 });
    expect(read.body.lastReadSeq).toBe(2);
    expect((await http().get('/api/chats').set(bearer(boris.token))).body[0].unreadCount).toBe(0);
    // Anna sees how far Boris has read
    const members = (await http().get(`/api/chats/${chat.id}`).set(bearer(anna.token))).body.members;
    expect(members.find((m: { userId: string }) => m.userId === boris.id).lastReadSeq).toBe(2);
  });

  it('sending a message does not count as reading the earlier ones (no false read receipts)', async () => {
    const { anna, boris } = await people('anna', 'boris');
    const g = (await group(anna.token, 'Team', [boris.id])).body;
    await send(anna.token, g.id, 'please confirm you saw this');
    await send(boris.token, g.id, 'replying from my other phone, chat never opened here');

    const chat = (await http().get(`/api/chats/${g.id}`).set(bearer(anna.token))).body;
    expect(chat.members.find((m: { userId: string }) => m.userId === boris.id).lastReadSeq).toBe(0);
    expect((await http().get('/api/chats').set(bearer(boris.token))).body[0].unreadCount).toBe(1); // Anna's message is still unread for Boris
  });

  it('never moves backwards and never past the last message', async () => {
    const { anna, boris } = await people('anna', 'boris');
    const chat = (await direct(anna.token, boris.id)).body;
    await send(anna.token, chat.id, 'one');
    await send(anna.token, chat.id, 'two');
    expect((await http().post(`/api/chats/${chat.id}/read`).set(bearer(boris.token)).send({ seq: 999 })).body.lastReadSeq).toBe(2);
    expect((await http().post(`/api/chats/${chat.id}/read`).set(bearer(boris.token)).send({ seq: 1 })).body.lastReadSeq).toBe(2);
    expect((await http().post(`/api/chats/${chat.id}/read`).set(bearer(boris.token)).send({ seq: -5 })).status).toBe(400);
  });

  it('a deleted message no longer counts as unread', async () => {
    const { anna, boris } = await people('anna', 'boris');
    const chat = (await direct(anna.token, boris.id)).body;
    const m = (await send(anna.token, chat.id, 'oops')).body;
    await http().delete(`/api/chats/${chat.id}/messages/${m.id}`).set(bearer(anna.token)).expect(200);
    expect((await http().get('/api/chats').set(bearer(boris.token))).body[0].unreadCount).toBe(0);
  });
});

describe('editing and deleting', () => {
  it('only the author may change a message; the previous text is kept in the audit log', async () => {
    const { anna, boris } = await people('anna', 'boris');
    const chat = (await direct(anna.token, boris.id)).body;
    const m = (await send(anna.token, chat.id, 'first draft')).body;

    expect((await http().patch(`/api/chats/${chat.id}/messages/${m.id}`).set(bearer(boris.token)).send({ body: 'hijack' })).status).toBe(403);
    expect((await http().delete(`/api/chats/${chat.id}/messages/${m.id}`).set(bearer(boris.token))).status).toBe(403);

    const edited = await http().patch(`/api/chats/${chat.id}/messages/${m.id}`).set(bearer(anna.token)).send({ body: 'final text' });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ body: 'final text' });
    expect(edited.body.editedAt).toBeTruthy();

    const entry = await prisma.auditLog.findFirst({ where: { action: 'message.edited' } });
    expect((entry!.data as { previousBody: string }).previousBody).toBe('first draft');
  });

  it('deleting blanks the text for everyone but keeps the original in the audit log', async () => {
    const { anna, boris } = await people('anna', 'boris');
    const chat = (await direct(anna.token, boris.id)).body;
    const m = (await send(anna.token, chat.id, 'regrettable')).body;
    const del = await http().delete(`/api/chats/${chat.id}/messages/${m.id}`).set(bearer(anna.token));
    expect(del.body).toMatchObject({ deleted: true, body: null });

    const history = (await http().get(`/api/chats/${chat.id}/messages`).set(bearer(boris.token))).body.messages;
    expect(history[0]).toMatchObject({ deleted: true, body: null });
    expect(JSON.stringify(history)).not.toContain('regrettable');
    expect((await http().patch(`/api/chats/${chat.id}/messages/${m.id}`).set(bearer(anna.token)).send({ body: 'revive' })).status).toBe(400);

    const entry = await prisma.auditLog.findFirst({ where: { action: 'message.deleted' } });
    expect((entry!.data as { previousBody: string }).previousBody).toBe('regrettable');
  });
});

describe('group chats', () => {
  it('creator becomes owner; needs at least one other member', async () => {
    const { anna, boris } = await people('anna', 'boris');
    expect((await group(anna.token, 'Solo', [anna.id])).status).toBe(400);
    const g = await group(anna.token, 'Бухгалтерия', [boris.id]);
    expect(g.status).toBe(201);
    expect(g.body.members.find((m: { userId: string }) => m.userId === anna.id).role).toBe('OWNER');
    expect(g.body.title).toBe('Бухгалтерия');
  });

  it('only the owner renames, adds and removes; members may leave', async () => {
    const { anna, boris, carl, dina } = await people('anna', 'boris', 'carl', 'dina');
    const g = (await group(anna.token, 'Team', [boris.id])).body;

    expect((await http().patch(`/api/chats/${g.id}`).set(bearer(boris.token)).send({ title: 'Mine' })).status).toBe(403);
    expect((await http().post(`/api/chats/${g.id}/members`).set(bearer(boris.token)).send({ userIds: [carl.id] })).status).toBe(403);
    expect((await http().patch(`/api/chats/${g.id}`).set(bearer(anna.token)).send({ title: 'Renamed' })).body.title).toBe('Renamed');

    // newcomers do not see the whole history as unread
    await send(anna.token, g.id, 'history 1');
    await send(anna.token, g.id, 'history 2');
    await http().post(`/api/chats/${g.id}/members`).set(bearer(anna.token)).send({ userIds: [carl.id] }).expect(200);
    expect((await http().get('/api/chats').set(bearer(carl.token))).body[0].unreadCount).toBe(0);
    expect((await http().get(`/api/chats/${g.id}/messages`).set(bearer(carl.token))).body.messages).toHaveLength(2);

    // removed people lose access immediately
    expect((await http().delete(`/api/chats/${g.id}/members/${carl.id}`).set(bearer(boris.token))).status).toBe(403);
    await http().delete(`/api/chats/${g.id}/members/${carl.id}`).set(bearer(anna.token)).expect(204);
    expect((await http().get(`/api/chats/${g.id}/messages`).set(bearer(carl.token))).status).toBe(404);

    // a member can leave on their own
    await http().delete(`/api/chats/${g.id}/members/${boris.id}`).set(bearer(boris.token)).expect(204);
    expect((await send(boris.token, g.id, 'still here?')).status).toBe(404);
    expect(dina.id).toBeTruthy();
  });

  it('when the owner leaves, the group passes to the longest-standing member', async () => {
    const { anna, boris, carl } = await people('anna', 'boris', 'carl');
    const g = (await group(anna.token, 'Team', [boris.id, carl.id])).body;
    await prisma.chatMember.update({ where: { chatId_userId: { chatId: g.id, userId: carl.id } }, data: { joinedAt: new Date(Date.now() + 60_000) } });
    await http().delete(`/api/chats/${g.id}/members/${anna.id}`).set(bearer(anna.token)).expect(204);
    const members = (await http().get(`/api/chats/${g.id}`).set(bearer(boris.token))).body.members;
    expect(members.find((m: { userId: string }) => m.userId === boris.id).role).toBe('OWNER');
    expect(members).toHaveLength(2);
  });

  it('direct chats cannot be managed like groups', async () => {
    const { anna, boris, carl } = await people('anna', 'boris', 'carl');
    const d = (await direct(anna.token, boris.id)).body;
    expect((await http().patch(`/api/chats/${d.id}`).set(bearer(anna.token)).send({ title: 'x' })).status).toBe(400);
    expect((await http().post(`/api/chats/${d.id}/members`).set(bearer(anna.token)).send({ userIds: [carl.id] })).status).toBe(400);
  });

  it('lets each member choose their own notification mode', async () => {
    const { anna, boris } = await people('anna', 'boris');
    const g = (await group(anna.token, 'Team', [boris.id])).body;
    await http().patch(`/api/chats/${g.id}/me`).set(bearer(boris.token)).send({ notifyMode: 'MENTIONS' }).expect(200);
    expect((await http().get('/api/chats').set(bearer(boris.token))).body[0].notifyMode).toBe('MENTIONS');
    expect((await http().get('/api/chats').set(bearer(anna.token))).body[0].notifyMode).toBe('ALL');
    expect((await http().patch(`/api/chats/${g.id}/me`).set(bearer(boris.token)).send({ notifyMode: 'SHOUT' })).status).toBe(400);
  });
});

describe('real-time events', () => {
  it('delivers new messages and read marks to members only', async () => {
    const { anna, boris, carl } = await people('anna', 'boris', 'carl');
    const seen: { users: string[]; event: string; payload: unknown }[] = [];
    app.get(RealtimeService).attach((users, event, payload) => seen.push({ users, event, payload }), () => undefined);
    try {
      const chat = (await direct(anna.token, boris.id)).body;
      seen.length = 0;
      await send(anna.token, chat.id, 'hello');
      const ev = seen.find((e) => e.event === 'message:new')!;
      expect(ev.users.sort()).toEqual([anna.id, boris.id].sort()); // the author's other devices get it too; carl does not
      expect(ev.users).not.toContain(carl.id);
      await http().post(`/api/chats/${chat.id}/read`).set(bearer(boris.token)).send({ seq: 1 });
      expect(seen.some((e) => e.event === 'chat:read')).toBe(true);
    } finally {
      app.get(RealtimeService).attach(() => undefined, () => undefined);
    }
  });
});
