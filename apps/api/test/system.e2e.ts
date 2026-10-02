import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DISK_ALARM_FREE, DISK_WARN_FREE, diskLevel } from '../src/system/system.service';
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

describe('system status', () => {
  it('warns early and loudly about a filling disk', () => {
    expect(diskLevel(0.5)).toBe('ok');
    expect(diskLevel(DISK_WARN_FREE)).toBe('ok');
    expect(diskLevel(DISK_WARN_FREE - 0.01)).toBe('warn');
    expect(diskLevel(DISK_ALARM_FREE - 0.01)).toBe('alarm');
    expect(diskLevel(0)).toBe('alarm');
  });

  it('is for administrators only', async () => {
    await makeUser('anna');
    await makeUser('boss', ['MANAGEMENT']);
    const anna = (await loginAs(app, 'anna')).body.accessToken;
    const boss = (await loginAs(app, 'boss')).body.accessToken;
    expect((await http().get('/api/system/status').set(bearer(anna))).status).toBe(403);
    expect((await http().get('/api/system/status').set(bearer(boss))).status).toBe(403);
    expect((await http().get('/api/system/status')).status).toBe(401);
  });

  it('reports the database, the disk, the files, the phones and the people', async () => {
    await makeUser('root', ['ADMIN']);
    const anna = await makeUser('anna');
    await makeUser('bob');
    await prisma.user.update({ where: { id: anna.id }, data: { lockedUntil: new Date(Date.now() + 600_000) } });
    const token = (await loginAs(app, 'root')).body.accessToken;
    const s = (await http().get('/api/system/status').set(bearer(token))).body;
    expect(s.database.ok).toBe(true);
    expect(s.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(s.database.sizeBytes).toBeGreaterThan(0);
    expect(['ok', 'warn', 'alarm']).toContain(s.disk.level);
    expect(s.disk.totalBytes).toBeGreaterThan(s.disk.freeBytes - 1);
    expect(s.disk.freeShare).toBeGreaterThan(0);
    expect(s.files).toEqual({ count: 0, bytes: 0 });
    expect(s.push.enabled).toBe(true);
    expect(s.users).toEqual({ active: 3, locked: 1 });
    expect(s.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
