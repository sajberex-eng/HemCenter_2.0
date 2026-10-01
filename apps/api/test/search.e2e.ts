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

type P = { id: string; token: string };
async function person(login: string, roles: ('EMPLOYEE' | 'ADMIN')[] = ['EMPLOYEE']): Promise<P> {
  const u = await makeUser(login, roles);
  return { id: u.id, token: (await loginAs(app, login)).body.accessToken };
}
const direct = async (a: P, b: P) => (await http().post('/api/chats/direct').set(bearer(a.token)).send({ userId: b.id })).body.id as string;
const say = async (p: P, chat: string, body: string, extra: object = {}) => (await http().post(`/api/chats/${chat}/messages`).set(bearer(p.token)).send({ body, ...extra })).body;
const find = (p: P, q: string, params = '') => http().get(`/api/search/messages?q=${encodeURIComponent(q)}${params}`).set(bearer(p.token));
const bodies = (res: request.Response) => res.body.hits.map((h: { body: string }) => h.body);

describe('what is found', () => {
  it('matches any part of a word, ignoring case, in Russian and Kazakh', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const chat = await direct(anna, boris);
    await say(anna, chat, 'Приказ №15 подписан');
    await say(anna, chat, 'Қазақстан Республикасы');
    await say(anna, chat, 'совсем другое');

    expect(bodies(await find(boris, 'ПРИКАЗ'))).toEqual(['Приказ №15 подписан']);
    // Cyrillic "каз" is a plain substring of "Приказ" but is not Kazakh "қаз": the two scripts are different letters
    expect(bodies(await find(boris, 'каз'))).toEqual(['Приказ №15 подписан']);
    expect(bodies(await find(boris, 'қазақ'))).toEqual(['Қазақстан Республикасы']);
    expect(bodies(await find(boris, 'ҚАЗАҚСТАН'))).toEqual(['Қазақстан Республикасы']);
    expect(bodies(await find(boris, '№15'))).toEqual(['Приказ №15 подписан']);
  });

  it('understands Russian word forms', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const chat = await direct(anna, boris);
    await say(anna, chat, 'Приказы утверждены директором');
    await say(anna, chat, 'Согласовали реестры поставщиков');
    expect(bodies(await find(boris, 'приказ'))).toEqual(['Приказы утверждены директором']);
    expect(bodies(await find(boris, 'реестр'))).toEqual(['Согласовали реестры поставщиков']);
  });

  it('finds messages by the name of an attached file', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const chat = await direct(anna, boris);
    const up = await http().post(`/api/chats/${chat}/attachments`).set(bearer(anna.token)).attach('file', Buffer.from('x'), { filename: 'Договор-поставки-2026.docx' });
    await say(anna, chat, 'во вложении', { attachmentIds: [up.body.id] });
    const res = await find(boris, 'договор-пост');
    expect(res.body.hits).toHaveLength(1);
    expect(res.body.hits[0].attachments[0].name).toBe('Договор-поставки-2026.docx');
  });

  it('newest first, with paging', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const chat = await direct(anna, boris);
    for (let i = 1; i <= 35; i++) await say(anna, chat, `отчёт номер ${i}`);
    const first = await find(boris, 'отчёт');
    expect(first.body.hits).toHaveLength(30);
    expect(first.body.hits[0].body).toBe('отчёт номер 35');
    expect(first.body.hasMore).toBe(true);
    const second = await find(boris, 'отчёт', '&offset=30');
    expect(bodies(second)).toEqual(['отчёт номер 5', 'отчёт номер 4', 'отчёт номер 3', 'отчёт номер 2', 'отчёт номер 1']);
    expect(second.body.hasMore).toBe(false);
  });

  it('can be limited to one chat', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const carl = await person('carl');
    const c1 = await direct(anna, boris);
    const c2 = await direct(anna, carl);
    await say(anna, c1, 'бюджет первый');
    await say(anna, c2, 'бюджет второй');
    expect(await find(anna, 'бюджет').then((r) => r.body.hits)).toHaveLength(2);
    expect(bodies(await find(anna, 'бюджет', `&chatId=${c2}`))).toEqual(['бюджет второй']);
  });
});

describe('who can find what', () => {
  it('never returns messages from chats the caller is not in, administrators included', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const carl = await person('carl');
    const root = await person('root', ['ADMIN']);
    const chat = await direct(anna, boris);
    await say(anna, chat, 'секретная премия директору');

    for (const outsider of [carl, root]) {
      expect((await find(outsider, 'премия')).body.hits).toEqual([]);
      expect((await find(outsider, 'премия', `&chatId=${chat}`)).body.hits).toEqual([]);
    }
    expect(bodies(await find(boris, 'премия'))).toHaveLength(1);
  });

  it('a member removed from a group can no longer find its messages', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const g = (await http().post('/api/chats/groups').set(bearer(anna.token)).send({ title: 'Team', memberIds: [boris.id] })).body.id as string;
    await say(anna, g, 'план закупок на квартал');
    expect(bodies(await find(boris, 'закупок'))).toHaveLength(1);
    await http().delete(`/api/chats/${g}/members/${boris.id}`).set(bearer(anna.token)).expect(204);
    expect((await find(boris, 'закупок')).body.hits).toEqual([]);
  });

  it('deleted messages disappear from search', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const chat = await direct(anna, boris);
    const m = await say(anna, chat, 'ошибочное сообщение про увольнение');
    expect(bodies(await find(boris, 'увольнение'))).toHaveLength(1);
    await http().delete(`/api/chats/${chat}/messages/${m.id}`).set(bearer(anna.token)).expect(200);
    expect((await find(boris, 'увольнение')).body.hits).toEqual([]);
    expect((await find(anna, 'увольнение')).body.hits).toEqual([]);
  });

  it('requires sign-in', async () => {
    expect((await http().get('/api/search/messages?q=abc')).status).toBe(401);
  });
});

describe('hostile input', () => {
  it('treats % _ and ! as ordinary characters', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const chat = await direct(anna, boris);
    await say(anna, chat, 'скидка 100% только сегодня');
    await say(anna, chat, 'сумма 1000 тенге');
    await say(anna, chat, 'файл_итог_v2');
    await say(anna, chat, 'файлXитогXv2');
    await say(anna, chat, 'ура!!! победа');

    expect(bodies(await find(boris, '100%'))).toEqual(['скидка 100% только сегодня']); // not "1000"
    expect(bodies(await find(boris, 'файл_итог'))).toEqual(['файл_итог_v2']); // "_" is not "any character"
    expect(bodies(await find(boris, '!!!'))).toEqual(['ура!!! победа']);
    expect((await find(boris, '%%')).body.hits).toEqual([]); // a bare wildcard matches nothing
  });

  it('is not an injection point', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const chat = await direct(anna, boris);
    await say(anna, chat, 'обычное сообщение');
    for (const evil of [`'; DROP TABLE "Message"; --`, `' OR '1'='1`, `")) UNION SELECT 1 --`, '\\\\', 'x\\']) {
      const res = await find(boris, evil);
      expect(res.status, evil).toBe(200);
      expect(res.body.hits, evil).toEqual([]);
    }
    expect(await prisma.message.count()).toBe(1);
  });

  it('rejects empty, one-character and oversized queries; ignores junk numbers', async () => {
    const anna = await person('anna');
    for (const q of ['', ' ', 'а', ' а ']) expect((await find(anna, q)).status, JSON.stringify(q)).toBe(400);
    expect((await find(anna, 'x'.repeat(101))).status).toBe(400);
    expect((await find(anna, 'ok', '&offset=abc')).status).toBe(200);
    expect((await find(anna, 'ok', '&chatId=not-a-uuid')).status).toBe(400);
  });
});

describe('jumping to a hit (messages around a number)', () => {
  it('returns a window on both sides and says whether more exist', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const chat = await direct(anna, boris);
    for (let i = 1; i <= 100; i++) await say(anna, chat, `m${i}`);

    const mid = await http().get(`/api/chats/${chat}/messages?around=50`).set(bearer(boris.token));
    expect(mid.body.messages[0].seq).toBe(25);
    expect(mid.body.messages.at(-1).seq).toBe(75);
    expect(mid.body.hasMore).toBe(true);
    expect(mid.body.hasNewer).toBe(true);

    const start = await http().get(`/api/chats/${chat}/messages?around=3`).set(bearer(boris.token));
    expect(start.body.messages[0].seq).toBe(1);
    expect(start.body.hasMore).toBe(false);

    const end = await http().get(`/api/chats/${chat}/messages?around=98`).set(bearer(boris.token));
    expect(end.body.messages.at(-1).seq).toBe(100);
    expect(end.body.hasNewer).toBe(false);

    const latest = await http().get(`/api/chats/${chat}/messages`).set(bearer(boris.token));
    expect(latest.body.hasNewer).toBe(false);
  });

  it('is only for members, and junk numbers do not crash', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const carl = await person('carl');
    const chat = await direct(anna, boris);
    await say(anna, chat, 'hi');
    expect((await http().get(`/api/chats/${chat}/messages?around=1`).set(bearer(carl.token))).status).toBe(404);
    for (const q of ['around=abc', 'before=abc', 'limit=-5', 'around=-1']) {
      expect((await http().get(`/api/chats/${chat}/messages?${q}`).set(bearer(boris.token))).status, q).toBe(200);
    }
  });
});

describe('pinned messages', () => {
  it('either person pins in a direct chat; newest pin first; unpinning works', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const chat = await direct(anna, boris);
    const a = await say(anna, chat, 'первое');
    const b = await say(boris, chat, 'второе');
    await http().post(`/api/chats/${chat}/pins`).set(bearer(boris.token)).send({ messageId: a.id }).expect(200);
    await new Promise((r) => setTimeout(r, 15));
    const list = await http().post(`/api/chats/${chat}/pins`).set(bearer(anna.token)).send({ messageId: b.id });
    expect(list.body.map((m: { body: string }) => m.body)).toEqual(['второе', 'первое']);
    await http().post(`/api/chats/${chat}/pins`).set(bearer(anna.token)).send({ messageId: b.id }).expect(200); // idempotent
    expect((await http().get(`/api/chats/${chat}/pins`).set(bearer(boris.token))).body).toHaveLength(2);

    await http().delete(`/api/chats/${chat}/pins/${a.id}`).set(bearer(anna.token)).expect(204);
    expect((await http().get(`/api/chats/${chat}/pins`).set(bearer(boris.token))).body.map((m: { body: string }) => m.body)).toEqual(['второе']);
  });

  it('in a group only the owner pins; at most five pins', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const g = (await http().post('/api/chats/groups').set(bearer(anna.token)).send({ title: 'Team', memberIds: [boris.id] })).body.id as string;
    const first = await say(anna, g, 'важно');
    expect((await http().post(`/api/chats/${g}/pins`).set(bearer(boris.token)).send({ messageId: first.id })).status).toBe(403);
    for (let i = 0; i < 4; i++) await http().post(`/api/chats/${g}/pins`).set(bearer(anna.token)).send({ messageId: (await say(anna, g, `п${i}`)).id }).expect(200);
    await http().post(`/api/chats/${g}/pins`).set(bearer(anna.token)).send({ messageId: first.id }).expect(200); // the fifth
    const sixth = await say(anna, g, 'шестое');
    const res = await http().post(`/api/chats/${g}/pins`).set(bearer(anna.token)).send({ messageId: sixth.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('TOO_MANY_PINS');
  });

  it('outsiders see nothing; foreign or deleted messages cannot be pinned; deleting unpins', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const carl = await person('carl');
    const chat = await direct(anna, boris);
    const other = await direct(anna, carl);
    const m = await say(anna, chat, 'закреплю');
    const foreign = await say(anna, other, 'в другом чате');

    expect((await http().get(`/api/chats/${chat}/pins`).set(bearer(carl.token))).status).toBe(404);
    expect((await http().post(`/api/chats/${chat}/pins`).set(bearer(carl.token)).send({ messageId: m.id })).status).toBe(404);
    expect((await http().post(`/api/chats/${chat}/pins`).set(bearer(anna.token)).send({ messageId: foreign.id })).status).toBe(404);

    await http().post(`/api/chats/${chat}/pins`).set(bearer(anna.token)).send({ messageId: m.id }).expect(200);
    await http().delete(`/api/chats/${chat}/messages/${m.id}`).set(bearer(anna.token)).expect(200);
    expect((await http().get(`/api/chats/${chat}/pins`).set(bearer(boris.token))).body).toEqual([]);
    expect(await prisma.pin.count()).toBe(0);
    expect((await http().post(`/api/chats/${chat}/pins`).set(bearer(anna.token)).send({ messageId: m.id })).status).toBe(404);
  });
});
