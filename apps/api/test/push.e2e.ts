import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PushSender, type PushTarget } from '../src/push/push-sender';
import { PushService } from '../src/push/push.service';
import { localMinutes } from '../src/push/push-rules';
import { bearer, createApp, loginAs, makeUser, prisma, resetDb } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());

class FakeSender extends PushSender {
  sent: { endpoint: string; payload: Record<string, string> }[] = [];
  failWith: { statusCode: number } | null = null;
  async send(t: PushTarget, payload: string) {
    if (this.failWith) throw this.failWith;
    this.sent.push({ endpoint: t.endpoint, payload: JSON.parse(payload) });
  }
}
let sender: FakeSender;

beforeAll(async () => {
  app = await createApp();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  sender = new FakeSender();
  app.get(PushService).useSender(sender);
});

type P = { id: string; token: string; endpoint: string };
const ep = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}-${Math.random().toString(36).slice(2)}`;
const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };

async function person(login: string, locale: 'ru' | 'kk' = 'ru'): Promise<P> {
  const u = await makeUser(login);
  if (locale !== 'ru') await prisma.user.update({ where: { id: u.id }, data: { locale } });
  return { id: u.id, token: (await loginAs(app, login)).body.accessToken, endpoint: ep(login) };
}
const subscribe = (p: P) => http().post('/api/push/subscriptions').set(bearer(p.token)).send({ endpoint: p.endpoint, keys: KEYS });
const subscribed = async (login: string, locale: 'ru' | 'kk' = 'ru') => {
  const p = await person(login, locale);
  await subscribe(p).expect(204);
  return p;
};
const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
};
const say = (token: string, chatId: string, body: object) => http().post(`/api/chats/${chatId}/messages`).set(bearer(token)).send(body);
const direct = async (a: P, b: P) => (await http().post('/api/chats/direct').set(bearer(a.token)).send({ userId: b.id })).body.id as string;

describe('subscriptions', () => {
  it('reports whether push is configured and hands out the public key', async () => {
    const p = await person('anna');
    const cfg = await http().get('/api/push/config').set(bearer(p.token));
    expect(cfg.body.enabled).toBe(true);
    expect(cfg.body.publicKey).toBe(process.env.VAPID_PUBLIC_KEY);
    expect(JSON.stringify(cfg.body)).not.toContain(process.env.VAPID_PRIVATE_KEY!);
  });

  it('only accepts addresses of real push services', async () => {
    const p = await person('anna');
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'https://localhost/x', 'https://evil.example.com/fcm.googleapis.com']) {
      const res = await http().post('/api/push/subscriptions').set(bearer(p.token)).send({ endpoint, keys: KEYS });
      expect(res.status, endpoint).toBe(400);
      expect(res.body.message).toBe('PUSH_ENDPOINT_NOT_ALLOWED');
    }
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it('rejects malformed keys, is idempotent, and moves a device to its new owner', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    expect((await http().post('/api/push/subscriptions').set(bearer(anna.token)).send({ endpoint: anna.endpoint, keys: { p256dh: 'bad key!', auth: 'x' } })).status).toBe(400);
    await subscribe(anna).expect(204);
    await subscribe(anna).expect(204);
    expect(await prisma.pushSubscription.count()).toBe(1);

    // the same browser is now used by Boris: the notifications must follow him, not stay with Anna
    await http().post('/api/push/subscriptions').set(bearer(boris.token)).send({ endpoint: anna.endpoint, keys: KEYS }).expect(204);
    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: anna.endpoint } });
    expect(row.userId).toBe(boris.id);
    expect(await prisma.pushSubscription.count()).toBe(1);
  });

  it('a user can remove only their own device', async () => {
    const anna = await subscribed('anna');
    const boris = await person('boris');
    await http().delete('/api/push/subscriptions').set(bearer(boris.token)).send({ endpoint: anna.endpoint }).expect(204);
    expect(await prisma.pushSubscription.count()).toBe(1); // untouched
    await http().delete('/api/push/subscriptions').set(bearer(anna.token)).send({ endpoint: anna.endpoint }).expect(204);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it('requires sign-in', async () => {
    expect((await http().get('/api/push/config')).status).toBe(401);
    expect((await http().post('/api/push/subscriptions').send({})).status).toBe(401);
  });
});

describe('settings', () => {
  it('stores do-not-disturb and quiet hours and validates the clock', async () => {
    const p = await person('anna');
    const until = new Date(Date.now() + 3600_000).toISOString();
    const ok = await http().patch('/api/push/settings').set(bearer(p.token)).send({ dndUntil: until, quietStart: '22:00', quietEnd: '07:00' });
    expect(ok.body).toMatchObject({ dndUntil: until, quietStart: '22:00', quietEnd: '07:00' });
    expect((await http().patch('/api/push/settings').set(bearer(p.token)).send({ quietStart: '25:99' })).status).toBe(400);
    expect((await http().patch('/api/push/settings').set(bearer(p.token)).send({ dndUntil: 'tomorrow' })).status).toBe(400);
    const cleared = await http().patch('/api/push/settings').set(bearer(p.token)).send({ dndUntil: null, quietStart: null, quietEnd: null });
    expect(cleared.body).toMatchObject({ dndUntil: null, quietStart: null, quietEnd: null });
  });
});

describe('delivery', () => {
  it('sends a generic notification with no message text and no file names, to the recipient only', async () => {
    const anna = await subscribed('anna');
    const boris = await subscribed('boris');
    const carl = await subscribed('carl'); // subscribed but not in this chat
    const chat = await direct(anna, boris);

    await say(anna.token, chat, { body: 'СЕКРЕТНЫЙ-ТЕКСТ-123 бюджет' }).then((r) => expect(r.status).toBe(201));
    await waitFor(() => sender.sent.length >= 1);
    await settle();

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].endpoint).toBe(boris.endpoint);
    // test users are named "User <login>", which is shortened to "User a."
    expect(sender.sent[0].payload).toEqual({ title: 'HemCenter', body: 'Новое сообщение от User a.', tag: `chat:${chat}`, url: `/chats/${chat}` });
    const wire = JSON.stringify(sender.sent[0].payload);
    expect(wire).not.toContain('СЕКРЕТНЫЙ');
    expect(wire).not.toContain('бюджет');
    expect(sender.sent.some((s) => s.endpoint === carl.endpoint || s.endpoint === anna.endpoint)).toBe(false);
  });

  it('does not reveal an attachment name either', async () => {
    const anna = await subscribed('anna');
    const boris = await subscribed('boris');
    const chat = await direct(anna, boris);
    const up = await http().post(`/api/chats/${chat}/attachments`).set(bearer(anna.token)).attach('file', Buffer.from('x'), { filename: 'Увольнение-Иванова.docx' });
    await say(anna.token, chat, { attachmentIds: [up.body.id] }).then((r) => expect(r.status).toBe(201));
    await waitFor(() => sender.sent.length >= 1);
    expect(JSON.stringify(sender.sent)).not.toContain('Увольнение');
  });

  it('speaks each recipient\'s own language', async () => {
    const anna = await subscribed('anna');
    const boris = await subscribed('boris', 'kk');
    const chat = await direct(anna, boris);
    await say(anna.token, chat, { body: 'сәлем' });
    await waitFor(() => sender.sent.length >= 1);
    expect(sender.sent[0].payload.body).toMatch(/жаңа хабарлама$/);
  });

  it('follows the per-chat mode: mentions only, and muted', async () => {
    const anna = await subscribed('anna');
    const boris = await subscribed('boris');
    const g = (await http().post('/api/chats/groups').set(bearer(anna.token)).send({ title: 'Team', memberIds: [boris.id] })).body.id as string;
    await http().patch(`/api/chats/${g}/me`).set(bearer(boris.token)).send({ notifyMode: 'MENTIONS' }).expect(200);

    await say(anna.token, g, { body: 'обычное сообщение' });
    await settle();
    expect(sender.sent).toHaveLength(0);

    await say(anna.token, g, { body: 'Борис, посмотри', mentionIds: [boris.id] });
    await waitFor(() => sender.sent.length >= 1);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].payload.body).toMatch(/упомянул\(а\) вас$/);

    sender.sent.length = 0;
    await http().patch(`/api/chats/${g}/me`).set(bearer(boris.token)).send({ notifyMode: 'NONE' }).expect(200);
    await say(anna.token, g, { body: 'ещё раз', mentionIds: [boris.id] });
    await settle();
    expect(sender.sent).toHaveLength(0); // muted means muted, even for mentions
  });

  it('stays quiet during do-not-disturb and quiet hours', async () => {
    const anna = await subscribed('anna');
    const boris = await subscribed('boris');
    const chat = await direct(anna, boris);

    await http().patch('/api/push/settings').set(bearer(boris.token)).send({ dndUntil: new Date(Date.now() + 3600_000).toISOString() });
    await say(anna.token, chat, { body: 'one' });
    await settle();
    expect(sender.sent).toHaveLength(0);

    await http().patch('/api/push/settings').set(bearer(boris.token)).send({ dndUntil: null });
    const nowMin = localMinutes(new Date(), process.env.APP_TIMEZONE ?? 'Asia/Almaty');
    const hhmm = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String((((m % 1440) + 1440) % 1440) % 60).padStart(2, '0')}`;
    await http().patch('/api/push/settings').set(bearer(boris.token)).send({ quietStart: hhmm(nowMin - 60), quietEnd: hhmm(nowMin + 60) });
    await say(anna.token, chat, { body: 'two' });
    await settle();
    expect(sender.sent).toHaveLength(0);

    await http().patch('/api/push/settings').set(bearer(boris.token)).send({ quietStart: null, quietEnd: null });
    await say(anna.token, chat, { body: 'three' });
    await waitFor(() => sender.sent.length >= 1);
    expect(sender.sent).toHaveLength(1);
  });

  it('does not notify blocked users', async () => {
    const anna = await subscribed('anna');
    const boris = await subscribed('boris');
    const chat = await direct(anna, boris);
    await prisma.user.update({ where: { id: boris.id }, data: { isActive: false } });
    await say(anna.token, chat, { body: 'hi' });
    await settle();
    expect(sender.sent).toHaveLength(0);
  });
});

describe('failures', () => {
  it('removes a subscription the push service reports as gone (410 and 404)', async () => {
    for (const statusCode of [410, 404]) {
      await resetDb();
      const anna = await subscribed('anna');
      const boris = await subscribed('boris');
      const chat = await direct(anna, boris);
      sender.failWith = { statusCode };
      await say(anna.token, chat, { body: 'hi' });
      await settle();
      expect(await prisma.pushSubscription.count({ where: { userId: boris.id } }), String(statusCode)).toBe(0);
    }
  });

  it('keeps a device through a few temporary errors, then drops it', async () => {
    const anna = await subscribed('anna');
    const boris = await subscribed('boris');
    const chat = await direct(anna, boris);
    sender.failWith = { statusCode: 503 };
    await say(anna.token, chat, { body: '1' });
    await settle();
    expect((await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: boris.endpoint } })).failures).toBe(1);
    for (let i = 2; i <= 5; i++) {
      await say(anna.token, chat, { body: String(i) });
      await settle(200);
    }
    expect(await prisma.pushSubscription.count({ where: { userId: boris.id } })).toBe(0);
  });

  it('a broken push never breaks sending the message', async () => {
    const anna = await subscribed('anna');
    const boris = await subscribed('boris');
    const chat = await direct(anna, boris);
    sender.failWith = { statusCode: 500 };
    sender.send = async () => {
      throw new Error('boom');
    };
    const res = await say(anna.token, chat, { body: 'still delivered' });
    expect(res.status).toBe(201);
    await settle();
    expect(await prisma.message.count()).toBe(1);
  });

  it('does nothing when push is not configured', async () => {
    const anna = await subscribed('anna');
    const boris = await subscribed('boris');
    const chat = await direct(anna, boris);
    const keep = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    try {
      expect((await http().get('/api/push/config').set(bearer(anna.token))).body).toEqual({ enabled: false, publicKey: null });
      expect((await say(anna.token, chat, { body: 'hi' })).status).toBe(201);
      await settle();
      expect(sender.sent).toHaveLength(0);
    } finally {
      process.env.VAPID_PUBLIC_KEY = keep.pub;
      process.env.VAPID_PRIVATE_KEY = keep.priv;
    }
  });
});
