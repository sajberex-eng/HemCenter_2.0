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

type R = 'ADMIN' | 'EMPLOYEE' | 'MANAGEMENT' | 'PROJECT_MANAGER';
async function person(login: string, roles: R[] = ['EMPLOYEE']) {
  const u = await makeUser(login, roles);
  return { id: u.id, token: (await loginAs(app, login)).body.accessToken as string };
}
type P = Awaited<ReturnType<typeof person>>;

const post = (p: P, url: string, body: object = {}) => http().post(`/api${url}`).set(bearer(p.token)).send(body);
const get = (p: P, url: string) => http().get(`/api${url}`).set(bearer(p.token));
const patch = (p: P, url: string, body: object) => http().patch(`/api${url}`).set(bearer(p.token)).send(body);
const put = (p: P, url: string, body: object) => http().put(`/api${url}`).set(bearer(p.token)).send(body);

const yesterday = () => new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
const nextWeek = () => new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);

async function team() {
  const lead = await person('lead', ['PROJECT_MANAGER']);
  const anna = await person('anna');
  const boris = await person('boris');
  const carl = await person('carl');
  const outsider = await person('outsider');
  const director = await person('director', ['MANAGEMENT']);
  return { lead, anna, boris, carl, outsider, director };
}

async function project(p: P, name: string, members: { userId: string; allocation: number }[], extra: object = {}) {
  const res = await post(p, '/projects', { name, members, ...extra });
  expect(res.status).toBe(201);
  return res.body as { id: string; chatId: string; members: { userId: string }[] };
}

const send = (p: P, chatId: string, body: string) => post(p, `/chats/${chatId}/messages`, { body });

describe('projects and their chat', () => {
  it('creates a project with a chat whose members are the team, led by the manager', async () => {
    const t = await team();
    const pr = await project(t.lead, 'Реестр поставщиков', [{ userId: t.anna.id, allocation: 50 }, { userId: t.boris.id, allocation: 30 }]);
    const chat = (await get(t.anna, `/chats/${pr.chatId}`)).body;
    expect(chat.type).toBe('GROUP');
    expect(chat.title).toBe('Реестр поставщиков');
    expect(chat.members.map((m: { userId: string }) => m.userId).sort()).toEqual([t.lead.id, t.anna.id, t.boris.id].sort());
    expect(chat.members.find((m: { userId: string }) => m.userId === t.lead.id).role).toBe('OWNER');
    expect(pr.members.map((m) => m.userId)).toContain(t.lead.id); // the manager is part of the team
  });

  it('only administrators, management and project managers may create projects', async () => {
    const t = await team();
    expect((await post(t.anna, '/projects', { name: 'X', members: [] })).status).toBe(403);
    expect((await post(t.director, '/projects', { name: 'X', managerId: t.lead.id, members: [] })).status).toBe(201);
  });

  it('team members and overseers see a project; everyone else gets "not found"', async () => {
    const t = await team();
    const pr = await project(t.lead, 'Закрытый', [{ userId: t.anna.id, allocation: 10 }]);
    expect((await get(t.anna, `/projects/${pr.id}`)).status).toBe(200);
    expect((await get(t.director, `/projects/${pr.id}`)).status).toBe(200);
    expect((await get(t.outsider, `/projects/${pr.id}`)).status).toBe(404);
    expect((await get(t.outsider, '/projects')).body).toEqual([]);
    expect((await get(t.anna, '/projects')).body).toHaveLength(1);
  });

  it('only the manager (or an overseer) changes the project; a member cannot', async () => {
    const t = await team();
    const pr = await project(t.lead, 'P', [{ userId: t.anna.id, allocation: 10 }]);
    expect((await patch(t.anna, `/projects/${pr.id}`, { status: 'ACTIVE' })).status).toBe(403);
    expect((await put(t.anna, `/projects/${pr.id}/members/${t.boris.id}`, { allocation: 10 })).status).toBe(403);
    expect((await patch(t.lead, `/projects/${pr.id}`, { status: 'ACTIVE' })).body.status).toBe('ACTIVE');
    expect((await patch(t.director, `/projects/${pr.id}`, { goal: 'Новая цель' })).body.goal).toBe('Новая цель');
  });

  it('keeps the chat in step with the team and refuses to edit the team from the chat', async () => {
    const t = await team();
    const pr = await project(t.lead, 'P', [{ userId: t.anna.id, allocation: 10 }]);
    await send(t.lead, pr.chatId, 'История до Бориса');
    await put(t.lead, `/projects/${pr.id}/members/${t.boris.id}`, { allocation: 20, roleTitle: 'Аналитик' }).expect(200);
    const boris = (await get(t.boris, '/chats')).body.find((c: { id: string }) => c.id === pr.chatId);
    expect(boris.unreadCount).toBe(0); // joined with the history marked read
    expect((await post(t.lead, `/chats/${pr.chatId}/members`, { userIds: [t.carl.id] })).body.message).toBe('PROJECT_CHAT_MANAGED');
    expect((await http().delete(`/api/chats/${pr.chatId}/members/${t.anna.id}`).set(bearer(t.lead.token))).body.message).toBe('PROJECT_CHAT_MANAGED');

    await http().delete(`/api/projects/${pr.id}/members/${t.boris.id}`).set(bearer(t.lead.token)).expect(200);
    expect((await get(t.boris, `/chats/${pr.chatId}`)).status).toBe(404);
    expect((await http().delete(`/api/projects/${pr.id}/members/${t.lead.id}`).set(bearer(t.lead.token))).body.message).toBe('CANNOT_REMOVE_MANAGER');
  });

  it('hands the project (and the chat) to a new manager', async () => {
    const t = await team();
    const pr = await project(t.lead, 'P', [{ userId: t.anna.id, allocation: 10 }]);
    await patch(t.director, `/projects/${pr.id}`, { managerId: t.anna.id }).expect(200);
    const chat = (await get(t.anna, `/chats/${pr.chatId}`)).body;
    expect(chat.members.filter((m: { role: string }) => m.role === 'OWNER').map((m: { userId: string }) => m.userId)).toEqual([t.anna.id]);
    expect((await patch(t.lead, `/projects/${pr.id}`, { status: 'ACTIVE' })).status).toBe(403);
  });

  it('validates people, dates and shares', async () => {
    const t = await team();
    expect((await post(t.lead, '/projects', { name: 'X', members: [{ userId: t.anna.id, allocation: 101 }] })).status).toBe(400);
    expect((await post(t.lead, '/projects', { name: 'X', members: [{ userId: '00000000-0000-4000-8000-000000000000', allocation: 10 }] })).body.message).toBe('USER_NOT_FOUND');
    expect((await post(t.lead, '/projects', { name: 'X', startDate: '2026-02-31' })).body.message).toBe('INVALID_DATE');
    expect((await post(t.lead, '/projects', { name: 'X', startDate: '2026-05-02', endDate: '2026-05-01' })).body.message).toBe('INVALID_DATE_RANGE');
    expect((await post(t.lead, '/projects', { name: '   ' })).status).toBe(400);
  });
});

describe('milestones (П-3.3.1)', () => {
  it('a milestone due in the past is shown as overdue until it is done', async () => {
    const t = await team();
    const pr = await project(t.lead, 'P', [{ userId: t.anna.id, allocation: 10 }]);
    const added = await post(t.lead, `/projects/${pr.id}/milestones`, { title: 'Сбор данных', dueDate: yesterday() });
    expect(added.status).toBe(201);
    await post(t.lead, `/projects/${pr.id}/milestones`, { title: 'Отчёт', dueDate: nextWeek() }).expect(201);
    const view = (await get(t.anna, `/projects/${pr.id}`)).body;
    expect(view.milestones.map((m: { title: string; overdue: boolean }) => [m.title, m.overdue])).toEqual([['Сбор данных', true], ['Отчёт', false]]);

    const done = await patch(t.lead, `/projects/${pr.id}/milestones/${view.milestones[0].id}`, { done: true });
    expect(done.body.milestones[0].overdue).toBe(false);
    expect(done.body.milestones[0].doneAt).toBeTruthy();
    expect((await post(t.anna, `/projects/${pr.id}/milestones`, { title: 'x', dueDate: nextWeek() })).status).toBe(403);
  });
});

describe('tasks (П-3.2.2)', () => {
  it('a task without a responsible person is not saved', async () => {
    const t = await team();
    const pr = await project(t.lead, 'P', [{ userId: t.anna.id, allocation: 10 }]);
    const m = (await send(t.lead, pr.chatId, 'Нужно подготовить смету')).body;
    const res = await post(t.lead, `/chats/${pr.chatId}/messages/${m.id}/task`, { title: 'Смета' });
    expect(res.status).toBe(400);
    expect(await prisma.task.count()).toBe(0);
    expect((await post(t.lead, `/chats/${pr.chatId}/messages/${m.id}/task`, { title: 'Смета', assigneeId: null })).status).toBe(400);
    expect((await post(t.lead, '/tasks', { title: 'Смета', projectId: pr.id })).status).toBe(400);
  });

  it('creates a task from a message: it joins the project, shows under the message, and survives deletion of the message', async () => {
    const t = await team();
    const pr = await project(t.lead, 'P', [{ userId: t.anna.id, allocation: 10 }]);
    const m = (await send(t.lead, pr.chatId, 'Анна, подготовьте смету')).body;
    const res = await post(t.lead, `/chats/${pr.chatId}/messages/${m.id}/task`, { title: 'Смета', assigneeId: t.anna.id, dueDate: nextWeek() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ projectId: pr.id, assigneeId: t.anna.id, status: 'OPEN', sourceMessageId: m.id, overdue: false });

    const page = (await get(t.anna, `/chats/${pr.chatId}/messages`)).body.messages;
    expect(page[0].tasks).toHaveLength(1);
    expect(page[0].tasks[0].title).toBe('Смета');
    expect((await get(t.anna, '/tasks?mine=1')).body.map((x: { id: string }) => x.id)).toEqual([res.body.id]);
    expect((await get(t.boris, '/tasks?mine=1')).body).toEqual([]);

    await http().delete(`/api/chats/${pr.chatId}/messages/${m.id}`).set(bearer(t.lead.token)).expect(200);
    expect((await get(t.anna, `/tasks/${res.body.id}`)).body.sourceMessageId).toBe(m.id); // the task outlives the message
    const after = (await get(t.anna, `/chats/${pr.chatId}/messages`)).body.messages;
    expect(after[0].tasks).toEqual([]);
  });

  it('the responsible person must be in the chat and, in a project, on the team', async () => {
    const t = await team();
    const pr = await project(t.lead, 'P', [{ userId: t.anna.id, allocation: 10 }]);
    const m = (await send(t.lead, pr.chatId, 'x')).body;
    expect((await post(t.lead, `/chats/${pr.chatId}/messages/${m.id}/task`, { title: 'T', assigneeId: t.boris.id })).body.message).toBe('ASSIGNEE_NOT_IN_CHAT');
    expect((await post(t.lead, '/tasks', { title: 'T', assigneeId: t.boris.id, projectId: pr.id })).body.message).toBe('ASSIGNEE_NOT_IN_PROJECT');
    // a stranger to the chat cannot create tasks from it
    expect((await post(t.outsider, `/chats/${pr.chatId}/messages/${m.id}/task`, { title: 'T', assigneeId: t.anna.id })).status).toBe(404);
  });

  it('the responsible person reports progress, but only the author or the manager edits the task itself', async () => {
    const t = await team();
    const pr = await project(t.lead, 'P', [{ userId: t.anna.id, allocation: 10 }, { userId: t.boris.id, allocation: 10 }]);
    const task = (await post(t.lead, '/tasks', { title: 'T', assigneeId: t.anna.id, projectId: pr.id })).body;
    const first = await patch(t.anna, `/tasks/${task.id}`, { status: 'IN_PROGRESS' });
    expect(first.body.message ?? first.body.status).toBe('IN_PROGRESS');
    const done = (await patch(t.anna, `/tasks/${task.id}`, { status: 'DONE' })).body;
    expect(done.status).toBe('DONE');
    expect((await patch(t.anna, `/tasks/${task.id}`, { title: 'Другое' })).status).toBe(403);
    expect((await patch(t.anna, `/tasks/${task.id}`, { assigneeId: t.boris.id })).status).toBe(403);
    expect((await patch(t.boris, `/tasks/${task.id}`, { status: 'DONE' })).status).toBe(403); // a teammate, not responsible
    expect((await patch(t.lead, `/tasks/${task.id}`, { assigneeId: t.boris.id, status: 'OPEN' })).body).toMatchObject({ assigneeId: t.boris.id, status: 'OPEN' });
    expect((await get(t.outsider, `/tasks/${task.id}`)).status).toBe(404);
  });

  it('lists overdue tasks and refuses to drop a member who still has open work', async () => {
    const t = await team();
    const pr = await project(t.lead, 'P', [{ userId: t.anna.id, allocation: 10 }]);
    await post(t.lead, '/tasks', { title: 'Старая', assigneeId: t.anna.id, projectId: pr.id, dueDate: yesterday() }).expect(201);
    await post(t.lead, '/tasks', { title: 'Новая', assigneeId: t.anna.id, projectId: pr.id, dueDate: nextWeek() }).expect(201);
    const late = (await get(t.lead, `/tasks?projectId=${pr.id}&overdue=1`)).body;
    expect(late.map((x: { title: string }) => x.title)).toEqual(['Старая']);
    expect((await http().delete(`/api/projects/${pr.id}/members/${t.anna.id}`).set(bearer(t.lead.token))).body.message).toBe('MEMBER_HAS_OPEN_TASKS');
  });

  it('a personal task is for oneself; only overseers hand tasks to others without a project', async () => {
    const t = await team();
    expect((await post(t.anna, '/tasks', { title: 'Моё', assigneeId: t.anna.id })).status).toBe(201);
    expect((await post(t.anna, '/tasks', { title: 'Чужое', assigneeId: t.boris.id })).status).toBe(403);
    expect((await post(t.director, '/tasks', { title: 'Поручение', assigneeId: t.boris.id })).status).toBe(201);
  });
});

describe('decisions (П-3.2.1)', () => {
  async function chatOfFour() {
    const t = await team();
    const pr = await project(t.lead, 'P', [{ userId: t.anna.id, allocation: 10 }, { userId: t.boris.id, allocation: 10 }, { userId: t.carl.id, allocation: 10 }]);
    const m = (await send(t.lead, pr.chatId, 'Переходим на новый формат реестра')).body;
    return { t, pr, m };
  }

  it('two agree, the third objects with a comment: "has objections", and the author sees the comment', async () => {
    const { t, pr, m } = await chatOfFour();
    const created = await post(t.lead, `/chats/${pr.chatId}/messages/${m.id}/decision`, { text: 'Новый формат реестра', addresseeIds: [t.anna.id, t.boris.id, t.carl.id] });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('PENDING');

    await post(t.anna, `/decisions/${created.body.id}/answer`, { answer: 'AGREE' }).expect(200);
    const second = await post(t.boris, `/decisions/${created.body.id}/answer`, { answer: 'AGREE' });
    expect(second.body.status).toBe('PENDING');
    const third = await post(t.carl, `/decisions/${created.body.id}/answer`, { answer: 'OBJECT', comment: 'Нет времени на переход' });
    expect(third.body.status).toBe('OBJECTIONS');

    const seenByAuthor = (await get(t.lead, `/chats/${pr.chatId}/messages`)).body.messages[0].decision;
    expect(seenByAuthor.status).toBe('OBJECTIONS');
    expect(seenByAuthor.responses.find((r: { userId: string }) => r.userId === t.carl.id)).toMatchObject({ answer: 'OBJECT', comment: 'Нет времени на переход' });
    expect(seenByAuthor.responses.filter((r: { answer: string }) => r.answer === 'AGREE')).toHaveLength(2);
  });

  it('an objection needs a comment; answering again replaces the answer and the old one stays in the audit log', async () => {
    const { t, pr, m } = await chatOfFour();
    const d = (await post(t.lead, `/chats/${pr.chatId}/messages/${m.id}/decision`, { text: 'T', addresseeIds: [t.carl.id] })).body;
    expect((await post(t.carl, `/decisions/${d.id}/answer`, { answer: 'OBJECT' })).body.message).toBe('COMMENT_REQUIRED');
    expect((await post(t.carl, `/decisions/${d.id}/answer`, { answer: 'OBJECT', comment: '   ' })).body.message).toBe('COMMENT_REQUIRED');
    await post(t.carl, `/decisions/${d.id}/answer`, { answer: 'OBJECT', comment: 'Против' }).expect(200);
    const changed = await post(t.carl, `/decisions/${d.id}/answer`, { answer: 'AGREE' });
    expect(changed.body.status).toBe('CONFIRMED');
    expect(changed.body.responses).toHaveLength(1);
    const log = await prisma.auditLog.findMany({ where: { action: 'decision.answered' }, orderBy: { id: 'asc' } });
    expect(log[1].data).toMatchObject({ answer: 'AGREE', previousAnswer: 'OBJECT', previousComment: 'Против' });
  });

  it('acknowledged counts as an answer; confirmed when everybody has answered', async () => {
    const { t, pr, m } = await chatOfFour();
    const d = (await post(t.lead, `/chats/${pr.chatId}/messages/${m.id}/decision`, { text: 'T', addresseeIds: [t.anna.id, t.boris.id] })).body;
    await post(t.anna, `/decisions/${d.id}/answer`, { answer: 'ACKNOWLEDGED' }).expect(200);
    expect((await post(t.boris, `/decisions/${d.id}/answer`, { answer: 'AGREE' })).body.status).toBe('CONFIRMED');
  });

  it('only addressees answer; strangers to the chat cannot even see it; one decision per message', async () => {
    const { t, pr, m } = await chatOfFour();
    const d = (await post(t.lead, `/chats/${pr.chatId}/messages/${m.id}/decision`, { text: 'T', addresseeIds: [t.anna.id] })).body;
    expect((await post(t.boris, `/decisions/${d.id}/answer`, { answer: 'AGREE' })).body.message).toBe('NOT_ADDRESSEE');
    expect((await post(t.outsider, `/decisions/${d.id}/answer`, { answer: 'AGREE' })).status).toBe(404);
    expect((await post(t.lead, `/chats/${pr.chatId}/messages/${m.id}/decision`, { text: 'ещё', addresseeIds: [t.anna.id] })).status).toBe(409);
    expect((await post(t.anna, `/decisions/${d.id}/answer`, { answer: 'MAYBE' })).status).toBe(400);
  });

  it('addressees must be chat members other than the author', async () => {
    const { t, pr, m } = await chatOfFour();
    const url = `/chats/${pr.chatId}/messages/${m.id}/decision`;
    expect((await post(t.lead, url, { text: 'T', addresseeIds: [t.outsider.id] })).body.message).toBe('ADDRESSEE_NOT_IN_CHAT');
    expect((await post(t.lead, url, { text: 'T', addresseeIds: [t.lead.id] })).body.message).toBe('ADDRESSEES_REQUIRED');
    expect((await post(t.lead, url, { text: 'T', addresseeIds: [] })).body.message).toBe('ADDRESSEES_REQUIRED');
    expect((await post(t.outsider, url, { text: 'T', addresseeIds: [t.anna.id] })).status).toBe(404);
  });

  it('lists what still waits for my answer', async () => {
    const { t, pr, m } = await chatOfFour();
    const d = (await post(t.lead, `/chats/${pr.chatId}/messages/${m.id}/decision`, { text: 'T', addresseeIds: [t.anna.id, t.boris.id] })).body;
    expect((await get(t.anna, '/decisions/pending')).body.map((x: { id: string }) => x.id)).toEqual([d.id]);
    await post(t.anna, `/decisions/${d.id}/answer`, { answer: 'AGREE' });
    expect((await get(t.anna, '/decisions/pending')).body).toEqual([]);
    expect((await get(t.boris, '/decisions/pending')).body).toHaveLength(1);
    expect((await get(t.carl, '/decisions/pending')).body).toEqual([]);
  });
});

describe('workload (П-3.4.1)', () => {
  it('50% + 40% + 30% in three projects is 120%: flagged in the profile and in the matrix', async () => {
    const t = await team();
    for (const [i, share] of [50, 40, 30].entries()) await project(t.lead, `Проект ${i + 1}`, [{ userId: t.anna.id, allocation: share }], { status: undefined });
    const mine = (await get(t.anna, '/workload/me')).body;
    expect(mine).toMatchObject({ total: 120, limit: 100, overloaded: true });
    expect(mine.projects.map((p: { allocation: number }) => p.allocation).sort()).toEqual([30, 40, 50]);

    const matrix = (await get(t.lead, '/workload/matrix')).body;
    const row = matrix.people.find((p: { userId: string }) => p.userId === t.anna.id);
    expect(row).toMatchObject({ total: 120, overloaded: true });
    expect(row.cells).toHaveLength(3);
    expect(matrix.projects).toHaveLength(3);

    // the project card shows it right where it is caused
    const card = (await get(t.lead, `/projects/${row.cells[0].projectId}`)).body;
    expect(card.members.find((m: { userId: string }) => m.userId === t.anna.id)).toMatchObject({ totalLoad: 120, overloaded: true });
  });

  it('exactly 100% is fine; a paused or finished project frees the person', async () => {
    const t = await team();
    const a = await project(t.lead, 'A', [{ userId: t.anna.id, allocation: 60 }]);
    await project(t.lead, 'B', [{ userId: t.anna.id, allocation: 40 }]);
    expect((await get(t.anna, '/workload/me')).body).toMatchObject({ total: 100, overloaded: false });
    const c = await project(t.lead, 'C', [{ userId: t.anna.id, allocation: 30 }]);
    expect((await get(t.anna, '/workload/me')).body.overloaded).toBe(true);
    await patch(t.lead, `/projects/${c.id}`, { status: 'ON_HOLD' }).expect(200);
    expect((await get(t.anna, '/workload/me')).body).toMatchObject({ total: 100, overloaded: false });
    await patch(t.lead, `/projects/${a.id}`, { status: 'DONE' }).expect(200);
    expect((await get(t.anna, '/workload/me')).body.total).toBe(40);
  });

  it('the matrix is for managers and overseers, not for ordinary employees', async () => {
    const t = await team();
    expect((await get(t.anna, '/workload/matrix')).status).toBe(403);
    expect((await get(t.director, '/workload/matrix')).status).toBe(200);
    expect((await get(t.lead, '/workload/matrix')).status).toBe(200);
  });
});
