import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Secret, TOTP } from 'otpauth';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/common/crypto';
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
afterEach(() => {
  process.env.REQUIRE_ADMIN_TOTP = 'false';
});

const codeFor = (secret: string, stepOffset = 0) =>
  new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30, algorithm: 'SHA1' }).generate({ timestamp: Date.now() + stepOffset * 30_000 });

/** Signs in and enrols 2FA. Returns the secret, recovery codes and a fresh access token. */
async function enrol(login: string) {
  const token = (await loginAs(app, login)).body.accessToken;
  const setup = await http().post('/api/auth/totp/setup').set(bearer(token)).expect(200);
  const enable = await http().post('/api/auth/totp/enable').set(bearer(token)).send({ code: codeFor(setup.body.secret) }).expect(200);
  // allow the next test step to use a code again without waiting 30 s
  await prisma.user.update({ where: { login }, data: { totpLastStep: null } });
  return { secret: setup.body.secret as string, recoveryCodes: enable.body.recoveryCodes as string[], token };
}

describe('enrolment', () => {
  it('stores the secret encrypted, rejects a wrong code, and issues 10 recovery codes', async () => {
    await makeUser('anna');
    const token = (await loginAs(app, 'anna')).body.accessToken;
    const setup = await http().post('/api/auth/totp/setup').set(bearer(token)).expect(200);
    expect(setup.body.uri).toMatch(/^otpauth:\/\/totp\//);

    const row = await prisma.user.findUnique({ where: { login: 'anna' } });
    expect(row!.totpSecretEnc).toBeTruthy();
    expect(row!.totpSecretEnc).not.toContain(setup.body.secret);
    expect(row!.totpEnabled).toBe(false); // not active until confirmed

    const bad = await http().post('/api/auth/totp/enable').set(bearer(token)).send({ code: '000000' });
    expect(bad.status).toBe(400);
    expect((await prisma.user.findUnique({ where: { login: 'anna' } }))!.totpEnabled).toBe(false);

    const ok = await http().post('/api/auth/totp/enable').set(bearer(token)).send({ code: codeFor(setup.body.secret) }).expect(200);
    expect(ok.body.recoveryCodes).toHaveLength(10);
    const stored = (await prisma.user.findUnique({ where: { login: 'anna' } }))!.totpRecoveryHashes;
    expect(stored).toHaveLength(10);
    expect(stored).not.toContain(ok.body.recoveryCodes[0]); // only hashes are stored

    expect((await http().post('/api/auth/totp/setup').set(bearer(token))).status).toBe(409);
  });

  it('encryption round-trips and detects tampering', () => {
    const blob = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(blob)).toBe('JBSWY3DPEHPK3PXP');
    const [iv, tag, ct] = blob.split('.');
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] ^= 1;
    expect(() => decryptSecret([iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
  });
});

describe('login with 2FA', () => {
  it('needs the second step, and the intermediate token is useless as an access token', async () => {
    await makeUser('anna');
    const { secret } = await enrol('anna');

    const step1 = await loginAs(app, 'anna');
    expect(step1.status).toBe(200);
    expect(step1.body.mfaRequired).toBe(true);
    expect(step1.body.accessToken).toBeUndefined();
    expect(step1.headers['set-cookie']).toBeUndefined();
    expect((await http().get('/api/auth/me').set(bearer(step1.body.mfaToken))).status).toBe(401);

    const wrong = await http().post('/api/auth/login/totp').send({ mfaToken: step1.body.mfaToken, code: '123456' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBe('TOTP_CODE_INVALID');

    const ok = await http().post('/api/auth/login/totp').send({ mfaToken: step1.body.mfaToken, code: codeFor(secret, 1) });
    expect(ok.status).toBe(200);
    expect(ok.headers['set-cookie']).toBeTruthy();
    expect((await http().get('/api/auth/me').set(bearer(ok.body.accessToken))).body.totpEnabled).toBe(true);
  });

  it('rejects a code that was already used (replay)', async () => {
    await makeUser('anna');
    const { secret } = await enrol('anna');
    const code = codeFor(secret, 1);
    const first = await loginAs(app, 'anna');
    await http().post('/api/auth/login/totp').send({ mfaToken: first.body.mfaToken, code }).expect(200);
    const second = await loginAs(app, 'anna');
    const replay = await http().post('/api/auth/login/totp').send({ mfaToken: second.body.mfaToken, code });
    expect(replay.status).toBe(401);
  });

  it('a recovery code works exactly once', async () => {
    await makeUser('anna');
    const { recoveryCodes } = await enrol('anna');
    const a = await loginAs(app, 'anna');
    await http().post('/api/auth/login/totp').send({ mfaToken: a.body.mfaToken, code: recoveryCodes[0] }).expect(200);
    const b = await loginAs(app, 'anna');
    expect((await http().post('/api/auth/login/totp').send({ mfaToken: b.body.mfaToken, code: recoveryCodes[0] })).status).toBe(401);
    expect((await http().post('/api/auth/login/totp').send({ mfaToken: b.body.mfaToken, code: recoveryCodes[1] })).status).toBe(200);
  });

  it('wrong codes count towards lockout even when the password is re-entered in between', async () => {
    await makeUser('anna');
    const { secret } = await enrol('anna');
    const wrong = async () => {
      const s = await loginAs(app, 'anna');
      return http().post('/api/auth/login/totp').send({ mfaToken: s.body.mfaToken, code: '111111' });
    };
    // 5 wrong codes, each preceded by a correct password; the password must not reset the counter
    for (let i = 0; i < 5; i++) expect((await wrong()).status).toBe(401);
    const s = await loginAs(app, 'anna');
    expect(s.status).toBe(403);
    expect(s.body.message).toBe('ACCOUNT_LOCKED');
    expect(secret).toBeTruthy();
  });

  it('a user can switch 2FA off with the password; a wrong password is refused', async () => {
    await makeUser('anna');
    const { token } = await enrol('anna');
    expect((await http().post('/api/auth/totp/disable').set(bearer(token)).send({ password: 'wrong-password-1' })).status).toBe(401);
    await http().post('/api/auth/totp/disable').set(bearer(token)).send({ password: PASSWORD }).expect(204);
    const login = await loginAs(app, 'anna');
    expect(login.body.mfaRequired).toBeUndefined();
    expect(login.body.accessToken).toBeTruthy();
  });
});

describe('mandatory 2FA for administrators', () => {
  it('blocks admin endpoints until enrolment, then allows them', async () => {
    process.env.REQUIRE_ADMIN_TOTP = 'true';
    await makeUser('root', ['ADMIN']);
    const token = (await loginAs(app, 'root')).body.accessToken;

    const me = await http().get('/api/auth/me').set(bearer(token));
    expect(me.body.mfaSetupRequired).toBe(true);
    const blocked = await http().get('/api/audit').set(bearer(token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toBe('MFA_SETUP_REQUIRED');
    expect((await http().get('/api/users').set(bearer(token))).status).toBe(200); // ordinary features still work

    const setup = await http().post('/api/auth/totp/setup').set(bearer(token)).expect(200);
    await http().post('/api/auth/totp/enable').set(bearer(token)).send({ code: codeFor(setup.body.secret) }).expect(200);
    expect((await http().get('/api/audit').set(bearer(token))).status).toBe(200);
    expect((await http().get('/api/auth/me').set(bearer(token))).body.mfaSetupRequired).toBe(false);
  });

  it('management is held to the same rule: no chat reading before enrolment, and 2FA cannot be switched off', async () => {
    process.env.REQUIRE_ADMIN_TOTP = 'true';
    await makeUser('director', ['MANAGEMENT']);
    const token = (await loginAs(app, 'director')).body.accessToken;
    expect((await http().get('/api/auth/me').set(bearer(token))).body.mfaSetupRequired).toBe(true);
    const blocked = await http().get('/api/oversight/chats').set(bearer(token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toBe('MFA_SETUP_REQUIRED');
    expect(await prisma.auditLog.count({ where: { action: { startsWith: 'oversight.' } } })).toBe(0);

    const setup = await http().post('/api/auth/totp/setup').set(bearer(token)).expect(200);
    await http().post('/api/auth/totp/enable').set(bearer(token)).send({ code: codeFor(setup.body.secret) }).expect(200);
    expect((await http().get('/api/oversight/chats').set(bearer(token))).status).toBe(200);
    const off = await http().post('/api/auth/totp/disable').set(bearer(token)).send({ password: PASSWORD });
    expect(off.status).toBe(403);
  });

  it('an administrator cannot switch 2FA off', async () => {
    process.env.REQUIRE_ADMIN_TOTP = 'true';
    await makeUser('root', ['ADMIN']);
    const { token } = await enrol('root');
    const res = await http().post('/api/auth/totp/disable').set(bearer(token)).send({ password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('MFA_REQUIRED_FOR_ADMIN');
  });

  it('another administrator can reset 2FA for a colleague who lost the device', async () => {
    await makeUser('root', ['ADMIN']);
    const anna = await makeUser('anna');
    await enrol('anna');
    const admin = (await loginAs(app, 'root')).body.accessToken;
    await http().post(`/api/users/${anna.id}/reset-totp`).set(bearer(admin)).expect(204);
    const login = await loginAs(app, 'anna');
    expect(login.body.mfaRequired).toBeUndefined(); // password alone works again, she can enrol anew
    expect((await prisma.auditLog.findMany({ where: { action: 'user.totp_reset' } })).length).toBe(1);
  });
});
