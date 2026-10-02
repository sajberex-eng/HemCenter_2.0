import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseDate, todayIn } from '../src/projects/project-rules';
import { bearer, createApp, loginAs, makeUser, prisma, resetDb, seedDocuments } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createApp();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  await seedDocuments(app);
});

type R = 'ADMIN' | 'EMPLOYEE' | 'MANAGEMENT' | 'PROJECT_MANAGER';
async function person(login: string, roles: R[] = ['EMPLOYEE']) {
  const u = await makeUser(login, roles);
  return { id: u.id, token: (await loginAs(app, login)).body.accessToken as string };
}
type P = Awaited<ReturnType<typeof person>>;
const get = (p: P, url: string) => http().get(`/api${url}`).set(bearer(p.token));
const post = (p: P, url: string, body: object = {}) => http().post(`/api${url}`).set(bearer(p.token)).send(body);
const day = (offset: number) => new Date(Date.parse(`${todayIn()}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

describe('dashboard', () => {
  it('is for management and administrators only', async () => {
    const anna = await person('anna');
    const lead = await person('lead', ['PROJECT_MANAGER']);
    const boss = await person('boss', ['MANAGEMENT']);
    expect((await get(anna, '/dashboard')).status).toBe(403);
    expect((await get(lead, '/dashboard')).status).toBe(403);
    expect((await http().get('/api/dashboard')).status).toBe(401);
    expect((await get(boss, '/dashboard')).status).toBe(200);
  });

  it('is empty and calm in an empty centre', async () => {
    const boss = await person('boss', ['MANAGEMENT']);
    const d = (await get(boss, '/dashboard')).body;
    expect(d.projects.byStatus).toEqual({ PLANNED: 0, ACTIVE: 0, ON_HOLD: 0, DONE: 0 });
    expect(d.assignments).toMatchObject({ open: 0, overdue: 0, inReview: 0, doneLast30Days: 0, overdueByPerson: [] });
    expect(d).toMatchObject({ tasks: { overdue: 0 }, decisionsWaiting: [], overloaded: [], documents: { inReview: 0, registeredThisMonth: 0 } });
  });

  it('shows what is late, what waits and who is overloaded', async () => {
    const boss = await person('boss', ['MANAGEMENT']);
    const lead = await person('lead', ['PROJECT_MANAGER']);
    const anna = await person('anna');
    const boris = await person('boris');

    // projects: one running with a milestone past its date, one planned, three shares for Anna making 120%
    const p1 = (await post(lead, '/projects', { name: 'Реестр', members: [{ userId: anna.id, allocation: 50 }] })).body;
    await http().patch(`/api/projects/${p1.id}`).set(bearer(lead.token)).send({ status: 'ACTIVE' }).expect(200);
    await post(lead, `/projects/${p1.id}/milestones`, { title: 'Сбор', dueDate: day(-3) }).expect(201);
    await post(lead, `/projects/${p1.id}/milestones`, { title: 'Отчёт', dueDate: day(10) }).expect(201);
    await post(lead, '/projects', { name: 'Второй', members: [{ userId: anna.id, allocation: 40 }, { userId: boris.id, allocation: 30 }] });
    await post(lead, '/projects', { name: 'Третий', members: [{ userId: anna.id, allocation: 30 }] });
    const task = (await post(lead, '/tasks', { title: 'Старая задача', assigneeId: anna.id, projectId: p1.id, dueDate: day(-1) })).body;
    expect(task.overdue).toBe(true);

    // assignments: two late for Anna, one late for Boris, one waiting for the controller, one fine, one done
    const give = async (who: P, extra: object = {}) => (await post(boss, '/assignments', { text: 'Дело', responsibleId: who.id, dueDate: day(5), ...extra })).body.id as string;
    for (const [who, n] of [[anna, 2], [boris, 1]] as const) for (let i = 0; i < n; i++) await prisma.assignment.update({ where: { id: await give(who) }, data: { dueDate: parseDate(day(-2))! } });
    const review = await give(anna);
    await post(anna, `/assignments/${review}/report`, { text: 'x' }).catch(() => undefined);
    await prisma.assignment.update({ where: { id: review }, data: { status: 'REVIEW', dueDate: parseDate(day(-4))! } }); // past its date, but with the controller
    await give(boris);
    const done = await give(boris);
    await prisma.assignment.update({ where: { id: done }, data: { status: 'DONE', doneAt: new Date() } });

    // a decision nobody has answered, two days old
    const chat = (await post(lead, '/chats/direct', { userId: anna.id })).body;
    const msg = (await post(lead, `/chats/${chat.id}/messages`, { body: 'Переходим на новый формат' })).body;
    const dec = (await post(lead, `/chats/${chat.id}/messages/${msg.id}/decision`, { text: 'Переходим на новый формат', addresseeIds: [anna.id] })).body;
    await prisma.decision.update({ where: { id: dec.id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });

    const d = (await get(boss, '/dashboard')).body;
    expect(d.projects.byStatus).toEqual({ PLANNED: 2, ACTIVE: 1, ON_HOLD: 0, DONE: 0 });
    expect(d.projects.withOverdueMilestones).toEqual([{ id: p1.id, name: 'Реестр', overdue: 1 }]);
    expect(d.tasks.overdue).toBe(1);
    expect(d.assignments).toMatchObject({ open: 5, overdue: 3, inReview: 1, doneLast30Days: 1 });
    expect(d.assignments.overdueByPerson.map((x: { userId: string; count: number }) => [x.userId, x.count])).toEqual([[anna.id, 2], [boris.id, 1]]);
    expect(d.decisionsWaiting).toEqual([{ id: dec.id, text: 'Переходим на новый формат', chatId: chat.id, waitingFor: 1, ageDays: 2 }]);
    expect(d.overloaded).toEqual([{ userId: anna.id, fullName: 'User anna', total: 120 }]);
  });

  it('counts documents in review and the ones registered this month', async () => {
    const boss = await person('boss', ['MANAGEMENT']);
    const anna = await person('anna');
    const law = await person('law');
    const kind = (await prisma.documentKind.findUniqueOrThrow({ where: { code: 'MEMO' } })).id;
    const draft = async (t: string) => (await post(anna, '/documents', { kindId: kind, lang: 'ru', title: t, data: {} })).body.id as string;
    const a = await draft('Одна');
    await draft('Черновик'); // drafts do not count
    await post(anna, `/documents/${a}/submit`, { route: [{ approverId: law.id }] }).expect(200);
    const b = await draft('Другая');
    await prisma.document.update({ where: { id: b }, data: { status: 'REGISTERED', registrationNumber: '1-СЗ/2026', registeredAt: new Date() } });
    const old = await draft('Старая');
    await prisma.document.update({ where: { id: old }, data: { status: 'REGISTERED', registrationNumber: '9-СЗ/2020', registeredAt: new Date('2020-01-15') } });
    expect((await get(boss, '/dashboard')).body.documents).toEqual({ inReview: 1, registeredThisMonth: 1 });
  });
});
