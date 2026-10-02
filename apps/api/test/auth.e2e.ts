import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createApp, loginAs, makeUser, PASSWORD, prisma, resetDb } from './helpers';

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

describe('auth', () => {
  it('logs in and returns the profile', async () => {
    await makeUser('anna');
    const res = await loginAs(app, 'Anna');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    const me = await http().get('/api/auth/me').set(bearer(res.body.accessToken));
    expect(me.body.login).toBe('anna');
    expect(me.body).not.toHaveProperty('passwordHash');
  });

  it('rejects wrong password and unknown login with the same error', async () => {
    await makeUser('anna');
    const a = await loginAs(app, 'anna', 'wrong-password-1');
    const b = await loginAs(app, 'nobody', 'wrong-password-1');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('locks the account after 5 failed attempts, even for the right password', async () => {
    await makeUser('anna');
    for (let i = 0; i < 5; i++) expect((await loginAs(app, 'anna', 'wrong-password-1')).status).toBe(401);
    const locked = await loginAs(app, 'anna');
    expect(locked.status).toBe(403);
    expect(locked.body.message).toBe('ACCOUNT_LOCKED');
  });

  it('requires a token for protected routes', async () => {
    expect((await http().get('/api/auth/me')).status).toBe(401);
    expect((await http().get('/api/users')).status).toBe(401);
  });

  it('rotates the refresh token and detects reuse', async () => {
    await makeUser('anna');
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ login: 'anna', password: PASSWORD }).expect(200);
    const first = (await agent.post('/api/auth/refresh').expect(200)).headers['set-cookie'];
    expect(first).toBeTruthy();
    // replay of the first (now rotated) cookie must fail and burn all sessions
    const login = await loginAs(app, 'anna');
    const oldCookie = login.headers['set-cookie'];
    await http().post('/api/auth/refresh').set('Cookie', oldCookie).expect(200); // rotates it
    const user = await prisma.user.findUnique({ where: { login: 'anna' } });

    // right away it is a lost cookie or a second tab, not theft: still honoured
    const race = await http().post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(race.status).toBe(200);

    // later it is a replay of a stolen token: every session is burned
    await prisma.session.updateMany({ where: { userId: user!.id, revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 60_000), rotatedAt: new Date(Date.now() - 60_000) } });
    const replay = await http().post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.message).toBe('UNAUTHORIZED');
    expect(await prisma.session.count({ where: { userId: user!.id, revokedAt: null } })).toBe(0);
  });

  it('answers simultaneous refreshes with the same cookie (two tabs, a reload) without logging anyone out', async () => {
    await makeUser('anna');
    const cookie = (await loginAs(app, 'anna')).headers['set-cookie'];
    const results = await Promise.all([0, 1, 2].map(() => http().post('/api/auth/refresh').set('Cookie', cookie)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const user = await prisma.user.findUnique({ where: { login: 'anna' } });
    expect(await prisma.session.count({ where: { userId: user!.id, revokedAt: null } })).toBe(3);
  });

  it('a cookie closed by logout does not work again, not even right away', async () => {
    await makeUser('anna');
    const cookie = (await loginAs(app, 'anna')).headers['set-cookie'];
    await http().post('/api/auth/logout').set('Cookie', cookie).expect(204);
    expect((await http().post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });

  it('a token rotated a moment ago stops working once the user logs out everywhere', async () => {
    await makeUser('anna');
    const login = await loginAs(app, 'anna');
    const old = login.headers['set-cookie'];
    const rotated = await http().post('/api/auth/refresh').set('Cookie', old).expect(200);
    expect((await http().post('/api/auth/refresh').set('Cookie', old)).status).toBe(200); // the grace window: a lost cookie, a second tab
    await http().post('/api/auth/logout-all').set(bearer(rotated.body.accessToken)).expect(204);
    expect((await http().post('/api/auth/refresh').set('Cookie', old)).status).toBe(401);
    expect((await http().post('/api/auth/refresh').set('Cookie', rotated.headers['set-cookie'])).status).toBe(401);
  });

  it('invalidates access tokens after logout-all', async () => {
    await makeUser('anna');
    const { body } = await loginAs(app, 'anna');
    await http().post('/api/auth/logout-all').set(bearer(body.accessToken)).expect(204);
    expect((await http().get('/api/auth/me').set(bearer(body.accessToken))).status).toBe(401);
  });

  it('enforces the password policy on change', async () => {
    await makeUser('anna');
    const { body } = await loginAs(app, 'anna');
    const weak = await http().post('/api/auth/change-password').set(bearer(body.accessToken)).send({ currentPassword: PASSWORD, newPassword: 'short1' });
    expect(weak.status).toBe(400);
    const noDigit = await http().post('/api/auth/change-password').set(bearer(body.accessToken)).send({ currentPassword: PASSWORD, newPassword: 'onlyletterslong' });
    expect(noDigit.status).toBe(400);
    const ok = await http().post('/api/auth/change-password').set(bearer(body.accessToken)).send({ currentPassword: PASSWORD, newPassword: 'N3w-password-ok' });
    expect(ok.status).toBe(204);
    expect((await loginAs(app, 'anna', 'N3w-password-ok')).status).toBe(200);
    expect((await loginAs(app, 'anna', PASSWORD)).status).toBe(401);
  });
});

describe('rate limiting', () => {
  it('limits login attempts per minute', async () => {
    process.env.DISABLE_THROTTLE = 'false';
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push((await loginAs(app, 'nobody', 'wrong-password-1')).status);
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses[11]).toBe(429);
    } finally {
      process.env.DISABLE_THROTTLE = 'true';
    }
  });
});

describe('users and roles', () => {
  it('forbids employees from managing users, allows the directory', async () => {
    await makeUser('anna');
    const { body } = await loginAs(app, 'anna');
    expect((await http().get('/api/users').set(bearer(body.accessToken))).status).toBe(200);
    const create = await http().post('/api/users').set(bearer(body.accessToken)).send({ login: 'bob', fullName: 'Bob Bobov', roles: ['EMPLOYEE'] });
    expect(create.status).toBe(403);
  });

  it('admin invites an employee who sets a password and consents', async () => {
    await makeUser('root', ['ADMIN']);
    const admin = (await loginAs(app, 'root')).body.accessToken;
    const created = await http().post('/api/users').set(bearer(admin)).send({ login: 'bob', fullName: 'Bob Bobov', roles: ['EMPLOYEE'], locale: 'kk' });
    expect(created.status).toBe(201);
    const token = created.body.inviteToken;
    // no password is usable before the invitation is accepted
    expect((await loginAs(app, 'bob', PASSWORD)).status).toBe(401);
    const noConsent = await http().post('/api/auth/accept-invite').send({ token, password: PASSWORD, consent: false });
    expect(noConsent.status).toBe(400);
    const accepted = await http().post('/api/auth/accept-invite').send({ token, password: PASSWORD, consent: true });
    expect(accepted.status).toBe(200);
    expect(accepted.body.user.locale).toBe('kk');
    expect((await prisma.user.findUnique({ where: { login: 'bob' } }))!.consentAt).not.toBeNull();
    // the link is single-use
    expect((await http().post('/api/auth/accept-invite').send({ token, password: PASSWORD, consent: true })).status).toBe(400);
  });

  it('rejects duplicate logins and unknown roles', async () => {
    await makeUser('root', ['ADMIN']);
    await makeUser('anna');
    const admin = (await loginAs(app, 'root')).body.accessToken;
    expect((await http().post('/api/users').set(bearer(admin)).send({ login: 'anna', fullName: 'Anna A', roles: ['EMPLOYEE'] })).status).toBe(409);
    expect((await http().post('/api/users').set(bearer(admin)).send({ login: 'x1y', fullName: 'Anna A', roles: ['GOD'] })).status).toBe(400);
  });

  it('deactivation kicks the user out immediately; admin cannot deactivate themselves', async () => {
    const root = await makeUser('root', ['ADMIN']);
    const anna = await makeUser('anna');
    const admin = (await loginAs(app, 'root')).body.accessToken;
    const annaToken = (await loginAs(app, 'anna')).body.accessToken;
    await http().patch(`/api/users/${anna.id}`).set(bearer(admin)).send({ isActive: false }).expect(200);
    expect((await http().get('/api/auth/me').set(bearer(annaToken))).status).toBe(401);
    expect((await loginAs(app, 'anna')).status).toBe(401);
    const self = await http().patch(`/api/users/${root.id}`).set(bearer(admin)).send({ isActive: false });
    expect(self.status).toBe(400);
  });

  it('role change takes effect on the next request', async () => {
    const root = await makeUser('root', ['ADMIN']);
    const anna = await makeUser('anna', ['ADMIN']);
    const annaToken = (await loginAs(app, 'anna')).body.accessToken;
    expect((await http().get('/api/audit').set(bearer(annaToken))).status).toBe(200);
    const admin = (await loginAs(app, 'root')).body.accessToken;
    await http().patch(`/api/users/${anna.id}`).set(bearer(admin)).send({ roles: ['EMPLOYEE'] }).expect(200);
    const again = (await loginAs(app, 'anna')).body.accessToken;
    expect((await http().get('/api/audit').set(bearer(again))).status).toBe(403);
    expect(root.id).toBeTruthy();
  });
});

describe('org structure', () => {
  it('admin manages departments; employees can only read', async () => {
    await makeUser('root', ['ADMIN']);
    await makeUser('anna');
    const admin = (await loginAs(app, 'root')).body.accessToken;
    const anna = (await loginAs(app, 'anna')).body.accessToken;
    const dep = await http().post('/api/departments').set(bearer(admin)).send({ nameRu: 'Бухгалтерия', nameKk: 'Бухгалтерия' });
    expect(dep.status).toBe(201);
    expect((await http().post('/api/departments').set(bearer(anna)).send({ nameRu: 'Х', nameKk: 'Х' })).status).toBe(403);
    expect((await http().get('/api/departments').set(bearer(anna))).body).toHaveLength(1);
    await http().delete(`/api/departments/${dep.body.id}`).set(bearer(admin)).expect(204);
  });
});

describe('audit log', () => {
  it('records actions and cannot be modified or deleted', async () => {
    await makeUser('root', ['ADMIN']);
    const admin = (await loginAs(app, 'root')).body.accessToken;
    await http().post('/api/positions').set(bearer(admin)).send({ nameRu: 'Юрист', nameKk: 'Заңгер' }).expect(201);
    const list = await http().get('/api/audit').set(bearer(admin));
    expect(list.body.map((r: { action: string }) => r.action)).toEqual(expect.arrayContaining(['auth.login', 'position.created']));
    await expect(prisma.auditLog.deleteMany()).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.updateMany({ data: { action: 'x' } })).rejects.toThrow(/append-only/);
  });
});

describe('audit log screen', () => {
  async function setup() {
    const admin = await makeUser('root', ['ADMIN']);
    const token = (await loginAs(app, 'root')).body.accessToken as string;
    return { admin, token };
  }

  it('shows who did what and when, but never the private content kept in the log', async () => {
    const { token } = await setup();
    const anna = await makeUser('anna');
    const boris = await makeUser('boris');
    const a = (await loginAs(app, 'anna')).body.accessToken;
    const chat = (await http().post('/api/chats/direct').set(bearer(a)).send({ userId: boris.id })).body;
    const msg = (await http().post(`/api/chats/${chat.id}/messages`).set(bearer(a)).send({ body: 'СЕКРЕТНЫЙ ПЕРВЫЙ ТЕКСТ' })).body;
    await http().patch(`/api/chats/${chat.id}/messages/${msg.id}`).set(bearer(a)).send({ body: 'Исправленный текст' }).expect(200);
    // the text really is kept in the database, for a legal request ...
    const kept = await prisma.auditLog.findFirstOrThrow({ where: { action: 'message.edited' } });
    expect(JSON.stringify(kept.data)).toContain('СЕКРЕТНЫЙ ПЕРВЫЙ ТЕКСТ');
    // ... but the administrator's screen and export do not carry it
    const list = await http().get('/api/audit?action=message.').set(bearer(token));
    expect(list.status).toBe(200);
    expect(list.body.map((r: { action: string }) => r.action)).toEqual(['message.edited']);
    expect(JSON.stringify(list.body)).not.toContain('СЕКРЕТНЫЙ');
    expect(Object.keys(list.body[0]).sort()).toEqual(['action', 'actorId', 'at', 'entityId', 'entityType', 'id', 'ip']);
    const csv = await http().get('/api/audit/export?action=message.').set(bearer(token));
    expect(csv.text).not.toContain('СЕКРЕТНЫЙ');
    void anna;
  });

  it('filters by person, kind of action and dates, and exports a safe CSV', async () => {
    const { token } = await setup();
    const anna = await makeUser('anna');
    await loginAs(app, 'anna');
    await http().post('/api/positions').set(bearer(token)).send({ nameRu: 'Юрист', nameKk: 'Заңгер' }).expect(201);
    const byActor = await http().get(`/api/audit?actorId=${anna.id}`).set(bearer(token));
    expect(byActor.body.every((r: { actorId: string }) => r.actorId === anna.id)).toBe(true);
    expect(byActor.body.length).toBeGreaterThan(0);
    expect((await http().get('/api/audit?action=position.').set(bearer(token))).body.map((r: { action: string }) => r.action)).toEqual(['position.created']);
    const today = new Date().toISOString().slice(0, 10);
    expect((await http().get(`/api/audit?from=${today}&to=${today}`).set(bearer(token))).body.length).toBeGreaterThan(0); // "to" includes the whole day
    expect((await http().get('/api/audit?from=2001-01-01&to=2001-01-02').set(bearer(token))).body).toEqual([]);
    expect((await http().get('/api/audit?from=вчера').set(bearer(token))).status).toBe(400);

    const csv = await http().get('/api/audit/export').set(bearer(token));
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('audit.csv');
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text.split('\r\n')[0]).toBe('﻿at,actor,action,entityType,entityId,ip');
    expect(csv.text).toContain('"position.created"');
    // the export is for administrators only
    const a = (await loginAs(app, 'anna')).body.accessToken;
    expect((await http().get('/api/audit/export').set(bearer(a))).status).toBe(403);
    expect((await http().get('/api/audit').set(bearer(a))).status).toBe(403);
  });

  it('a value that would be a spreadsheet formula is neutralised in the CSV', async () => {
    const { token } = await setup();
    await prisma.auditLog.create({ data: { action: '=HYPERLINK("http://evil")', entityType: '+cmd', entityId: '@x' } });
    const csv = (await http().get('/api/audit/export').set(bearer(token))).text;
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(`"'+cmd"`);
    expect(csv).not.toMatch(/,"=HYPERLINK/);
  });
});
