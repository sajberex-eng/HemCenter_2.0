import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AssignmentsService } from '../src/assignments/assignments.service';
import { PUSH_TEXT } from '../src/assignments/assignment-rules';
import { PushSender, type PushTarget } from '../src/push/push-sender';
import { PushService } from '../src/push/push.service';
import { parseDate, todayIn } from '../src/projects/project-rules';
import { bearer, createApp, loginAs, makeUser, prisma, resetDb, seedDocuments } from './helpers';
import { docxText } from './docx-text';

let app: INestApplication;
const http = () => request(app.getHttpServer());

class FakeSender extends PushSender {
  sent: { endpoint: string; payload: Record<string, string> }[] = [];
  async send(t: PushTarget, payload: string) {
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
  await seedDocuments(app);
  sender = new FakeSender();
  app.get(PushService).useSender(sender);
});

type R = 'ADMIN' | 'EMPLOYEE' | 'MANAGEMENT' | 'SECRETARY' | 'PROJECT_MANAGER';
async function person(login: string, roles: R[] = ['EMPLOYEE']) {
  const u = await makeUser(login, roles);
  return { id: u.id, token: (await loginAs(app, login)).body.accessToken as string };
}
type P = Awaited<ReturnType<typeof person>>;
const get = (p: P, url: string) => http().get(`/api${url}`).set(bearer(p.token));
const post = (p: P, url: string, body: object = {}) => http().post(`/api${url}`).set(bearer(p.token)).send(body);

const day = (offset: number) => new Date(Date.parse(`${todayIn()}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const buffer = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function team() {
  const boss = await person('boss', ['MANAGEMENT']);
  const anna = await person('anna');
  const boris = await person('boris');
  const stranger = await person('stranger');
  const lead = await person('lead', ['PROJECT_MANAGER']);
  return { boss, anna, boris, stranger, lead };
}
async function assign(giver: P, responsible: P, extra: object = {}) {
  const res = await post(giver, '/assignments', { text: 'Подготовить реестр', responsibleId: responsible.id, dueDate: day(7), ...extra });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}
const report = (p: P, id: string, text = 'Реестр готов', files: { name: string; data: Buffer }[] = []) => {
  let r = http().post(`/api/assignments/${id}/report`).set(bearer(p.token)).field('text', text);
  for (const f of files) r = r.attach('files', f.data, { filename: f.name });
  return r;
};
const types = async (userId: string) => (await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })).map((n) => n.type);

describe('giving an assignment', () => {
  it('those who run things give them; the controller defaults to the giver; strangers see nothing', async () => {
    const { boss, anna, boris, stranger, lead } = await team();
    expect((await post(anna, '/assignments', { text: 'Сделать', responsibleId: boris.id, dueDate: day(3) })).status).toBe(403);
    const a = await assign(lead, anna, { coResponsibleIds: [boris.id] });
    const full = (await get(anna, `/assignments/${a.id}`)).body;
    expect(full).toMatchObject({ status: 'NEW', responsibleId: anna.id, controllerId: lead.id, coResponsibleIds: [boris.id], overdue: false, dueDate: day(7), originalDue: day(7), sourceKind: 'MANUAL' });
    expect(full.can).toMatchObject({ start: true, report: true, review: false, requestDue: true, remove: false });
    expect((await get(lead, `/assignments/${a.id}`)).body.can).toMatchObject({ start: false, report: false, remove: true });
    expect((await get(boss, `/assignments/${a.id}`)).status).toBe(200); // management oversees
    expect((await get(stranger, `/assignments/${a.id}`)).status).toBe(404);
    expect(full.events.map((e: { kind: string }) => e.kind)).toEqual(['CREATED']);
  });

  it('checks the input', async () => {
    const { lead, anna } = await team();
    const ok = { text: 'Сделать', responsibleId: anna.id, dueDate: day(3) };
    expect((await post(lead, '/assignments', { ...ok, text: '  ' })).status).toBe(400);
    expect((await post(lead, '/assignments', { ...ok, dueDate: day(-1) })).body.message).toBe('DUE_IN_PAST');
    expect((await post(lead, '/assignments', { ...ok, dueDate: '2026-02-31' })).body.message).toBe('INVALID_DATE');
    expect((await post(lead, '/assignments', { ...ok, dueDate: day(0) })).status).toBe(201); // today is allowed
    expect((await post(lead, '/assignments', { ...ok, responsibleId: '00000000-0000-4000-8000-000000000000' })).body.message).toBe('USER_NOT_FOUND');
    expect((await post(lead, '/assignments', { ...ok, responsibleId: undefined })).status).toBe(400);
  });

  it('can be made from a chat message when both are in that chat', async () => {
    const { lead, anna, stranger } = await team();
    const chat = (await post(lead, '/chats/direct', { userId: anna.id })).body;
    const msg = (await post(lead, `/chats/${chat.id}/messages`, { body: 'Анна, нужен реестр' })).body;
    const url = `/chats/${chat.id}/messages/${msg.id}/assignment`;
    const body = { text: 'Подготовить реестр', responsibleId: anna.id, dueDate: day(5) };
    expect((await post(lead, url, { ...body, responsibleId: stranger.id })).body.message).toBe('ASSIGNEE_NOT_IN_CHAT');
    expect((await post(anna, url, body)).status).toBe(403); // an ordinary employee does not give assignments
    const ok = await post(lead, url, body);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ sourceKind: 'CHAT', sourceChatId: chat.id });
  });
});

describe('doing it: report, acceptance, return (П-3.7.1)', () => {
  it('start → report with a file → returned with a reason → report again → accepted', async () => {
    const { lead, anna, stranger } = await team();
    const { id } = await assign(lead, anna);
    expect((await post(lead, `/assignments/${id}/start`)).status).toBe(403); // not the responsible one
    expect((await post(anna, `/assignments/${id}/start`)).body.status).toBe('IN_PROGRESS');
    expect((await post(anna, `/assignments/${id}/start`)).body.message).toBe('WRONG_STATE');

    const first = await report(anna, id, 'Черновик реестра', [{ name: 'реестр.xlsx', data: Buffer.from('таблица') }]);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('REVIEW');
    expect(first.body.overdue).toBe(false);
    const rep = first.body.reports[0];
    expect(rep).toMatchObject({ authorId: anna.id, text: 'Черновик реестра', status: 'PENDING' });
    expect(rep.files).toEqual([{ id: expect.any(String), name: 'реестр.xlsx', size: Buffer.from('таблица').length }]);

    // the controller (and the responsible one) can read the file; a stranger cannot
    const dl = await http().get(`/api/report-files/${rep.files[0].id}`).set(bearer(lead.token)).buffer(true).parse(buffer);
    expect(dl.status).toBe(200);
    expect((dl.body as Buffer).toString()).toBe('таблица');
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect((await get(stranger, `/report-files/${rep.files[0].id}`)).status).toBe(404);

    // review: only the controller; a return needs a reason
    expect((await post(anna, `/assignments/${id}/reports/${rep.id}/accept`)).status).toBe(403);
    expect((await post(lead, `/assignments/${id}/reports/${rep.id}/return`)).body.message).toBe('COMMENT_REQUIRED');
    const back = await post(lead, `/assignments/${id}/reports/${rep.id}/return`, { comment: 'Не хватает двух поставщиков' });
    expect(back.body.status).toBe('RETURNED');
    expect(back.body.reports[0]).toMatchObject({ status: 'RETURNED', reviewComment: 'Не хватает двух поставщиков', reviewerId: lead.id });
    expect((await post(lead, `/assignments/${id}/reports/${rep.id}/accept`)).body.message).toBe('WRONG_STATE');

    const second = await report(anna, id, 'Дополнено');
    expect(second.body.status).toBe('REVIEW');
    const done = await post(lead, `/assignments/${id}/reports/${second.body.reports[1].id}/accept`, { comment: 'Принято' });
    expect(done.body).toMatchObject({ status: 'DONE', overdue: false });
    expect(done.body.doneAt).toBeTruthy();
    expect(done.body.events.map((e: { kind: string }) => e.kind)).toEqual(['CREATED', 'STARTED', 'REPORT', 'RETURNED', 'REPORT', 'ACCEPTED']);
    expect((await report(anna, id)).body.message).toBe('WRONG_STATE'); // finished

    // everybody was told, in the list
    expect(await types(anna.id)).toEqual(['ASSIGNED', 'REPORT_RETURNED', 'REPORT_ACCEPTED']);
    expect(await types(lead.id)).toEqual(['REPORT_SUBMITTED', 'REPORT_SUBMITTED']);
  });

  it('a refused file leaves no report behind and the assignment where it was', async () => {
    const { lead, anna } = await team();
    const { id } = await assign(lead, anna);
    const res = await report(anna, id, 'Отчёт', [{ name: 'ok.txt', data: Buffer.from('x') }, { name: 'virus.exe', data: Buffer.from('MZ') }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(await prisma.executionReport.count()).toBe(0);
    expect(await prisma.reportFile.count()).toBe(0);
    expect((await get(anna, `/assignments/${id}`)).body.status).toBe('NEW');
    expect((await report(anna, id, '   ')).status).toBe(400);
  });

  it('only the responsible person reports', async () => {
    const { lead, anna, boris } = await team();
    const { id } = await assign(lead, anna, { coResponsibleIds: [boris.id] });
    expect((await report(boris, id)).status).toBe(403); // a co-responsible person helps but does not report
    expect((await report(lead, id)).status).toBe(403);
  });
});

describe('moving the due date', () => {
  it('the responsible person asks, the controller decides; the history stays', async () => {
    const { lead, anna } = await team();
    const { id } = await assign(lead, anna);
    const url = `/assignments/${id}/due-requests`;
    expect((await post(anna, url, { newDue: day(-1), reason: 'x' })).body.message).toBe('DUE_IN_PAST');
    expect((await post(anna, url, { newDue: day(7), reason: 'x' })).body.message).toBe('SAME_DUE');
    expect((await post(anna, url, { newDue: day(14) })).status).toBe(400); // a reason is required
    expect((await post(lead, url, { newDue: day(14), reason: 'x' })).status).toBe(403);
    const asked = await post(anna, url, { newDue: day(14), reason: 'Ждём данных от бухгалтерии' });
    expect(asked.status).toBe(201);
    expect(asked.body.can).toMatchObject({ requestDue: false, decideDue: false }); // already asked
    expect((await post(anna, url, { newDue: day(20), reason: 'ещё' })).body.message).toBe('DUE_REQUEST_PENDING');

    const reqId = asked.body.dueChanges[0].id;
    expect((await post(anna, `${url}/${reqId}/approve`)).status).toBe(403);
    expect((await get(lead, `/assignments/${id}`)).body.can.decideDue).toBe(true);
    const approved = await post(lead, `${url}/${reqId}/approve`, { comment: 'Хорошо' });
    expect(approved.body).toMatchObject({ dueDate: day(14), originalDue: day(7) });
    expect(approved.body.dueChanges[0]).toMatchObject({ status: 'APPROVED', oldDue: day(7), newDue: day(14), decisionNote: 'Хорошо', decidedById: lead.id });
    expect((await post(lead, `${url}/${reqId}/approve`)).body.message).toBe('DUE_REQUEST_NOT_PENDING');

    // a second request, refused: the date stays
    const again = await post(anna, url, { newDue: day(30), reason: 'Отпуск' });
    const refused = await post(lead, `${url}/${again.body.dueChanges[1].id}/reject`, { comment: 'Нет' });
    expect(refused.body.dueDate).toBe(day(14));
    expect(refused.body.events.map((e: { kind: string }) => e.kind)).toEqual(['CREATED', 'DUE_REQUESTED', 'DUE_APPROVED', 'DUE_REQUESTED', 'DUE_REJECTED']);
    expect(await types(lead.id)).toEqual(['DUE_REQUESTED', 'DUE_REQUESTED']);
    expect(await types(anna.id)).toEqual(['ASSIGNED', 'DUE_APPROVED', 'DUE_REJECTED']);
  });
});

describe('taking an assignment off control', () => {
  it('the controller, the giver or management do it, with a reason; a finished one cannot be removed', async () => {
    const { lead, boss, anna, stranger } = await team();
    const { id } = await assign(lead, anna);
    await post(anna, `/assignments/${id}/due-requests`, { newDue: day(10), reason: 'Нужно время' });
    expect((await post(anna, `/assignments/${id}/remove`, { reason: 'сама' })).status).toBe(403);
    expect((await post(lead, `/assignments/${id}/remove`)).status).toBe(400);
    const removed = await post(boss, `/assignments/${id}/remove`, { reason: 'Больше не нужно' });
    expect(removed.body).toMatchObject({ status: 'REMOVED', removedReason: 'Больше не нужно' });
    expect(removed.body.dueChanges[0].status).toBe('REJECTED'); // an open request does not hang around
    expect((await post(lead, `/assignments/${id}/remove`, { reason: 'ещё раз' })).body.message).toBe('WRONG_STATE');
    expect((await post(stranger, `/assignments/${id}/remove`, { reason: 'x' })).status).toBe(404);
    expect(await types(anna.id)).toEqual(['ASSIGNED', 'REMOVED']);
  });
});

describe('lists and the head\'s summary', () => {
  it('"mine", "I control", "all" and the overdue filter', async () => {
    const { lead, boss, anna, boris } = await team();
    const a1 = await assign(lead, anna, { text: 'Первое' });
    const a2 = await assign(lead, boris, { text: 'Второе' });
    await prisma.assignment.update({ where: { id: a1.id }, data: { dueDate: parseDate(day(-2))! } });
    expect((await get(anna, '/assignments')).body.map((a: { id: string }) => a.id)).toEqual([a1.id]);
    expect((await get(lead, '/assignments?scope=control')).body).toHaveLength(2);
    expect((await get(anna, '/assignments?scope=all')).status).toBe(403);
    expect((await get(boss, '/assignments?scope=all')).body).toHaveLength(2);
    const late = (await get(boss, '/assignments?scope=all&state=overdue')).body;
    expect(late.map((a: { id: string }) => a.id)).toEqual([a1.id]);
    expect(late[0].overdue).toBe(true);
    // an assignment waiting for the controller's decision is not "late"
    await report(anna, a1.id).expect(200);
    expect((await get(boss, '/assignments?scope=all&state=overdue')).body).toEqual([]);
    expect((await get(boss, '/assignments?scope=all&state=review')).body.map((a: { id: string }) => a.id)).toEqual([a1.id]);
    void a2;
  });

  it('the summary for management groups what is late by person; others may not read it', async () => {
    const { lead, boss, anna, boris } = await team();
    for (const [who, n] of [[anna, 2], [boris, 1]] as const) {
      for (let i = 0; i < n; i++) {
        const a = await assign(lead, who, { text: `Дело ${i}` });
        await prisma.assignment.update({ where: { id: a.id }, data: { dueDate: parseDate(day(-1 - i))! } });
      }
    }
    await assign(lead, boris, { text: 'В срок' });
    expect((await get(lead, '/assignments/summary')).status).toBe(403);
    const s = (await get(boss, '/assignments/summary')).body;
    expect(s.overdue).toHaveLength(3);
    expect(s.byPerson).toEqual([{ userId: anna.id, count: 2 }, { userId: boris.id, count: 1 }]);
  });
});

describe('reminders', () => {
  it('3 days, 1 day, the day itself, then daily when late; once a day; the controller hears about the late ones', async () => {
    const { lead, anna } = await team();
    const svc = app.get(AssignmentsService);
    const cases: [string, number][] = [['D3', 3], ['D1', 1], ['D0', 0], ['LATE', -2], ['FAR', 6], ['TWO', 2]];
    const ids: Record<string, string> = {};
    for (const [name, off] of cases) {
      const a = await assign(lead, anna, { text: name });
      await prisma.assignment.update({ where: { id: a.id }, data: { dueDate: parseDate(day(off))! } });
      ids[name] = a.id;
    }
    await prisma.notification.deleteMany(); // forget "assigned"
    expect(await svc.remind()).toBe(4);
    const got = async (id: string) => (await prisma.notification.findMany({ where: { assignmentId: id } })).map((n) => `${n.type}:${n.userId === anna.id ? 'anna' : 'lead'}`).sort();
    expect(await got(ids.D3)).toEqual(['REMIND_D3:anna']);
    expect(await got(ids.D1)).toEqual(['REMIND_D1:anna']);
    expect(await got(ids.D0)).toEqual(['REMIND_D0:anna']);
    expect(await got(ids.LATE)).toEqual(['REMIND_OVERDUE:anna', 'REMIND_OVERDUE:lead']);
    expect(await got(ids.FAR)).toEqual([]);
    expect(await got(ids.TWO)).toEqual([]);

    expect(await svc.remind()).toBe(0); // the same day again: nothing new
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(await svc.remind(tomorrow)).toBeGreaterThanOrEqual(1); // the next day the late one is reminded again
    expect((await prisma.notification.count({ where: { assignmentId: ids.LATE } }))).toBe(4);
  });

  it('finished and waiting-for-review assignments are not nagged about', async () => {
    const { lead, anna } = await team();
    const a = await assign(lead, anna);
    await prisma.assignment.update({ where: { id: a.id }, data: { dueDate: parseDate(day(-1))! } });
    await report(anna, a.id).expect(200);
    await prisma.notification.deleteMany();
    expect(await app.get(AssignmentsService).remind()).toBe(0);
  });
});

describe('notifications', () => {
  it('everyone has their own list, with an unread counter that can be cleared', async () => {
    const { lead, anna, boris } = await team();
    await assign(lead, anna);
    await assign(lead, anna);
    const list = (await get(anna, '/notifications')).body;
    expect(list.unread).toBe(2);
    expect(list.items.map((i: { type: string }) => i.type)).toEqual(['ASSIGNED', 'ASSIGNED']);
    expect((await get(boris, '/notifications')).body).toEqual({ items: [], unread: 0 });
    // someone else's id changes nothing
    expect((await post(boris, '/notifications/read', { ids: [list.items[0].id] })).body.unread).toBe(0);
    expect((await get(anna, '/notifications')).body.unread).toBe(2);
    expect((await post(anna, '/notifications/read', { ids: [list.items[0].id] })).body.unread).toBe(1);
    expect((await post(anna, '/notifications/read')).body.unread).toBe(0);
  });

  it('the push says what happened and never the text of the assignment', async () => {
    const { lead, anna } = await team();
    const sub = { endpoint: `https://fcm.googleapis.com/fcm/send/anna-${Math.random().toString(36).slice(2)}`, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
    await post(anna, '/push/subscriptions', sub).expect(204);
    const { id } = await assign(lead, anna, { text: 'СЕКРЕТНОЕ-СОДЕРЖАНИЕ-ПОРУЧЕНИЯ' });
    const end = Date.now() + 3000;
    while (sender.sent.length === 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].payload).toEqual({ title: 'HemCenter', body: PUSH_TEXT.ASSIGNED.ru, tag: `assignment:${id}`, url: `/assignments/${id}` });
    expect(JSON.stringify(sender.sent[0].payload)).not.toContain('СЕКРЕТНОЕ');
  });
});

describe('from a registered protocol (П-3.5.1)', () => {
  it('registration turns the instructions of the protocol into assignments for their people, once', async () => {
    const chair = await person('chair');
    const sec = await person('sec', ['SECRETARY']);
    const anna = await person('anna');
    const boris = await person('boris');
    const law = await person('law');
    const m = (await post(chair, '/meetings', { subject: 'Планёрка', startsAt: '2026-10-15T09:00:00.000Z', secretaryId: sec.id, participantIds: [anna.id, boris.id], agenda: ['Реестр', 'Отпуска', 'Разное'] })).body;
    const [i1, i2] = m.items.map((i: { id: string }) => i.id);
    const res = (item: string, body: object) => post(chair, `/meetings/${m.id}/items/${item}/resolutions`, body).expect(201);
    await res(i1, { kind: 'DECISION', text: 'Утвердить реестр' });
    await res(i1, { kind: 'INSTRUCTION', text: 'Разослать реестр', responsibleId: anna.id, due: day(10) });
    await res(i2, { kind: 'DECISION', text: 'Принять график' });
    await res(i2, { kind: 'INSTRUCTION', text: 'Подготовить приказ', responsibleId: boris.id, due: day(14) });
    await res(i2, { kind: 'INSTRUCTION', text: 'Ознакомить сотрудников', responsibleId: anna.id, due: day(20) });
    const docId = (await post(chair, `/meetings/${m.id}/protocol`, { lang: 'ru' })).body.documentId as string;
    await post(chair, `/documents/${docId}/submit`, { route: [{ approverId: law.id }] }).expect(200);
    await post(law, `/documents/${docId}/approve`).expect(200);
    await http().post(`/api/documents/${docId}/scan`).set(bearer(chair.token)).attach('file', Buffer.from('%PDF-1.4 signed'), { filename: 'scan.pdf' }).expect(200);

    expect(await prisma.assignment.count()).toBe(0); // nothing is tracked before registration
    await post(sec, `/documents/${docId}/register`).expect(200);

    const mine = (await get(anna, '/assignments')).body;
    expect(mine.map((a: { text: string }) => a.text).sort()).toEqual(['Ознакомить сотрудников (п. 2 повестки)', 'Разослать реестр (п. 1 повестки)']);
    expect(mine[0]).toMatchObject({ controllerId: chair.id, sourceKind: 'DOCUMENT', sourceDocumentId: docId, status: 'NEW' });
    expect((await get(boris, '/assignments')).body).toHaveLength(1);
    expect((await get(boris, '/assignments')).body[0]).toMatchObject({ dueDate: day(14), text: 'Подготовить приказ (п. 2 повестки)' });
    expect(await prisma.assignment.count()).toBe(3);
    expect(await types(anna.id)).toEqual(['ASSIGNED', 'ASSIGNED']);
    expect((await get(chair, `/assignments?scope=control&documentId=${docId}`)).body).toHaveLength(3);

    // the whole way to the end: report, acceptance
    const first = mine.find((a: { text: string }) => a.text.startsWith('Разослать'));
    const rep = await report(anna, first.id, 'Разослано всем отделам');
    expect(rep.status).toBe(200);
    const accepted = await post(chair, `/assignments/${first.id}/reports/${rep.body.reports[0].id}/accept`);
    expect(accepted.body.status).toBe('DONE');

    // the number is in the file the people read
    const file = await http().get(`/api/documents/${docId}/file?format=docx`).set(bearer(chair.token)).buffer(true).parse(buffer);
    expect(docxText(file.body as Buffer)).toMatch(/ПРОТОКОЛ № 1-П\/\d{4}/);
  }, 120_000);

  it('order items with a named person and a date become assignments of the order\'s author; free-text names do not', async () => {
    const author = await person('author', ['SECRETARY']);
    const law = await person('law');
    const anna = await person('anna');
    const kind = (await prisma.documentKind.findUniqueOrThrow({ where: { code: 'ORDER' } })).id;
    const doc = (await post(author, '/documents', {
      kindId: kind, lang: 'ru', title: 'О графике',
      data: { items: [{ text: 'Утвердить график', responsible: 'Анна', responsibleId: anna.id, due: day(9) }, { text: 'Сообщить всем', responsible: 'Иван Петрович', due: day(9) }, { text: 'Без срока', responsibleId: anna.id }] },
    })).body.id as string;
    await post(author, `/documents/${doc}/submit`, { route: [{ approverId: law.id }] });
    await post(law, `/documents/${doc}/approve`);
    await http().post(`/api/documents/${doc}/scan`).set(bearer(author.token)).attach('file', Buffer.from('%PDF-1.4'), { filename: 's.pdf' });
    await post(author, `/documents/${doc}/register`).expect(200);
    const list = (await get(anna, '/assignments')).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ text: 'Утвердить график', controllerId: author.id, dueDate: day(9) });
    expect(await prisma.assignment.count()).toBe(1);
    expect((await post(author, `/documents/${doc}/register`)).body.message).toBe('ALREADY_REGISTERED');
    expect(await prisma.assignment.count()).toBe(1);

    // the creation step itself is safe to repeat: the same document never yields the same assignment twice
    const row = await prisma.document.findUniqueOrThrow({ where: { id: doc } });
    const again = await prisma.$transaction((tx) => app.get(AssignmentsService).createForDocument(tx, row, author as never));
    expect(again).toEqual([]);
    expect(await prisma.assignment.count()).toBe(1);
  }, 120_000);
});
