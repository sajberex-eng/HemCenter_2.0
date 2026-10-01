import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createApp, loginAs, makeUser, prisma, resetDb } from './helpers';

let app: INestApplication;
let port: number;
const sockets: Socket[] = [];
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createApp();
  port = (app.getHttpServer().address() as AddressInfo).port;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(resetDb);
afterEach(() => {
  sockets.splice(0).forEach((s) => s.close());
});

const connect = (token: string | undefined) => {
  const s = io(`http://localhost:${port}`, { path: '/api/socket.io', addTrailingSlash: false, transports: ['websocket'], auth: token ? { token } : {}, reconnection: false });
  sockets.push(s);
  return s;
};
const connected = (s: Socket) => new Promise<void>((res, rej) => { s.once('connect', () => res()); s.once('connect_error', rej); });
const disconnected = (s: Socket, ms = 3000) =>
  new Promise<string>((res, rej) => {
    const t = setTimeout(() => rej(new Error('still connected')), ms);
    s.once('disconnect', (reason) => { clearTimeout(t); res(reason); });
  });
const nextEvent = <T = unknown>(s: Socket, event: string, ms = 3000) =>
  new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`no ${event}`)), ms);
    s.once(event, (p: T) => { clearTimeout(t); res(p); });
  });
/** Resolves true if the event does NOT arrive within the window. */
const silent = (s: Socket, event: string, ms = 400) =>
  new Promise<boolean>((res) => {
    const h = () => res(false);
    s.once(event, h);
    setTimeout(() => { s.off(event, h); res(true); }, ms);
  });

async function person(login: string, roles: ('EMPLOYEE' | 'ADMIN')[] = ['EMPLOYEE']) {
  const u = await makeUser(login, roles);
  return { id: u.id, token: (await loginAs(app, login)).body.accessToken as string };
}

describe('socket delivery', () => {
  it('delivers a new message to the members\' live connections and to nobody else', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const carl = await person('carl');
    const chat = (await http().post('/api/chats/direct').set(bearer(anna.token)).send({ userId: boris.id })).body;

    const sBoris = connect(boris.token);
    const sCarl = connect(carl.token);
    await Promise.all([connected(sBoris), connected(sCarl)]);

    const got = nextEvent<{ body: string; chatId: string }>(sBoris, 'message:new');
    const leaked = silent(sCarl, 'message:new');
    await http().post(`/api/chats/${chat.id}/messages`).set(bearer(anna.token)).send({ body: 'hello live' }).expect(201);
    expect(await got).toMatchObject({ body: 'hello live', chatId: chat.id });
    expect(await leaked).toBe(true);
  });

  it('sends read marks to the other participant', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const chat = (await http().post('/api/chats/direct').set(bearer(anna.token)).send({ userId: boris.id })).body;
    await http().post(`/api/chats/${chat.id}/messages`).set(bearer(anna.token)).send({ body: 'ping' });
    const sAnna = connect(anna.token);
    await connected(sAnna);
    const mark = nextEvent(sAnna, 'chat:read');
    await http().post(`/api/chats/${chat.id}/read`).set(bearer(boris.token)).send({ seq: 1 });
    expect(await mark).toEqual({ chatId: chat.id, userId: boris.id, lastReadSeq: 1 });
  });
});

describe('socket authentication', () => {
  it('rejects a missing, garbage or intermediate (2FA) token', async () => {
    const anna = await person('anna');
    const mfa = await app.get(JwtService).signAsync({ sub: anna.id, purpose: 'mfa' }, { expiresIn: '5m' });
    for (const token of [undefined, 'garbage', mfa]) {
      const s = connect(token);
      // both happen back to back on the server, so wait for them together
      const [err] = await Promise.all([nextEvent(s, 'auth:error'), disconnected(s)]);
      expect(err).toEqual({ code: 'UNAUTHORIZED' });
      expect(s.connected).toBe(false);
    }
  });

  it('cuts the live connection when the user is blocked', async () => {
    const admin = await person('root', ['ADMIN']);
    const anna = await person('anna');
    const s = connect(anna.token);
    await connected(s);
    const gone = disconnected(s);
    await http().patch(`/api/users/${anna.id}`).set(bearer(admin.token)).send({ isActive: false }).expect(200);
    expect(await gone).toBe('io server disconnect');
    // and she cannot come back with the old token
    const again = connect(anna.token);
    expect(await nextEvent(again, 'auth:error')).toEqual({ code: 'UNAUTHORIZED' });
  });

  it('cuts the live connection on "sign out everywhere"', async () => {
    const anna = await person('anna');
    const s = connect(anna.token);
    await connected(s);
    const gone = disconnected(s);
    await http().post('/api/auth/logout-all').set(bearer(anna.token)).expect(204);
    expect(await gone).toBe('io server disconnect');
  });

  it('cuts the connection when its token expires, so revocation is bounded', async () => {
    const anna = await person('anna');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: anna.id } });
    const shortLived = await app.get(JwtService).signAsync({ sub: anna.id, tv: row.tokenVersion }, { expiresIn: '1s' });
    const s = connect(shortLived);
    await connected(s);
    expect(await disconnected(s, 4000)).toBe('io server disconnect');
  });
});
