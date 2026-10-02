import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createApp, loginAs, makeUser, prisma, resetDb, seedDocuments } from './helpers';
import { docxText } from './docx-text';

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

type R = 'ADMIN' | 'EMPLOYEE' | 'MANAGEMENT' | 'SECRETARY';
async function person(login: string, roles: R[] = ['EMPLOYEE']) {
  const u = await makeUser(login, roles);
  return { id: u.id, token: (await loginAs(app, login)).body.accessToken as string };
}
type P = Awaited<ReturnType<typeof person>>;
const get = (p: P, url: string) => http().get(`/api${url}`).set(bearer(p.token));
const post = (p: P, url: string, body: object = {}) => http().post(`/api${url}`).set(bearer(p.token)).send(body);
const patch = (p: P, url: string, body: object) => http().patch(`/api${url}`).set(bearer(p.token)).send(body);
const del = (p: P, url: string) => http().delete(`/api${url}`).set(bearer(p.token));
const put = (p: P, url: string) => http().put(`/api${url}`).set(bearer(p.token));
const buffer = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

const WHEN = '2026-10-15T09:00:00.000Z';
async function setup() {
  const chair = await person('chair');
  const sec = await person('sec');
  const anna = await person('anna');
  const boris = await person('boris');
  const outsider = await person('outsider');
  const secretaryOfOffice = await person('office', ['SECRETARY']);
  const director = await person('director', ['MANAGEMENT']);
  const res = await post(chair, '/meetings', { subject: 'Планёрка по закупкам', startsAt: WHEN, place: 'Каб. 12', chairId: chair.id, secretaryId: sec.id, participantIds: [anna.id, boris.id], agenda: ['Реестр поставщиков', 'График отпусков', 'Разное'] });
  expect(res.status).toBe(201);
  return { chair, sec, anna, boris, outsider, secretaryOfOffice, director, meeting: res.body as { id: string; chatId: string; items: { id: string }[] } };
}

describe('meetings', () => {
  it('creates a meeting with its own chat whose members are the participants', async () => {
    const { chair, sec, anna, boris, meeting, outsider } = await setup();
    const m = (await get(anna, `/meetings/${meeting.id}`)).body;
    expect(m.participantIds.sort()).toEqual([chair.id, sec.id, anna.id, boris.id].sort());
    expect(m.items.map((i: { title: string; position: number }) => [i.position, i.title])).toEqual([[1, 'Реестр поставщиков'], [2, 'График отпусков'], [3, 'Разное']]);
    const chat = (await get(anna, `/chats/${m.chatId}`)).body;
    expect(chat).toMatchObject({ type: 'GROUP', title: 'Планёрка по закупкам' });
    expect(chat.members.find((x: { userId: string }) => x.userId === chair.id).role).toBe('OWNER');
    expect((await get(outsider, `/meetings/${meeting.id}`)).status).toBe(404);
    expect((await get(outsider, '/meetings')).body).toEqual([]);
    expect((await get(anna, '/meetings')).body).toHaveLength(1);
  });

  it('keeping the registers or overseeing lets you see every meeting, but not change it', async () => {
    const { secretaryOfOffice, director, meeting } = await setup();
    for (const p of [secretaryOfOffice, director]) {
      expect((await get(p, `/meetings/${meeting.id}`)).body.canEdit).toBe(false);
      expect((await post(p, `/meetings/${meeting.id}/items`, { title: 'Чужой пункт' })).status).toBe(403);
    }
  });

  it('only the organisers change the agenda and the record', async () => {
    const { anna, sec, meeting } = await setup();
    expect((await post(anna, `/meetings/${meeting.id}/items`, { title: 'Мой пункт' })).status).toBe(403);
    const added = await post(sec, `/meetings/${meeting.id}/items`, { title: 'Новый пункт' });
    expect(added.status).toBe(201);
    expect(added.body.items.at(-1)).toMatchObject({ position: 4, title: 'Новый пункт' });
    const removed = await del(sec, `/meetings/${meeting.id}/items/${added.body.items[0].id}`);
    expect(removed.body.items.map((i: { position: number }) => i.position)).toEqual([1, 2, 3]); // renumbered without a gap
    expect((await post(sec, `/meetings/${meeting.id}/items`, { title: '   ' })).status).toBe(400);
  });

  it('the participants are managed through the meeting, not the chat', async () => {
    const { chair, anna, outsider, meeting } = await setup();
    expect((await post(chair, `/chats/${meeting.chatId}/members`, { userIds: [outsider.id] })).body.message).toBe('PROJECT_CHAT_MANAGED');
    expect((await put(chair, `/meetings/${meeting.id}/participants/${outsider.id}`)).body.participantIds).toContain(outsider.id);
    expect((await get(outsider, `/chats/${meeting.chatId}`)).status).toBe(200);
    expect((await del(chair, `/meetings/${meeting.id}/participants/${outsider.id}`)).body.participantIds).not.toContain(outsider.id);
    expect((await get(outsider, `/chats/${meeting.chatId}`)).status).toBe(404);
    expect((await del(chair, `/meetings/${meeting.id}/participants/${chair.id}`)).body.message).toBe('CANNOT_REMOVE_ORGANIZER');
    expect((await put(anna, `/meetings/${meeting.id}/participants/${outsider.id}`)).status).toBe(403);
  });

  it('validates the input', async () => {
    const { chair, anna } = await setup();
    const ok = { subject: 'Тема', startsAt: WHEN, participantIds: [anna.id] };
    expect((await post(chair, '/meetings', { ...ok, subject: '  ' })).status).toBe(400);
    expect((await post(chair, '/meetings', { ...ok, startsAt: 'вчера' })).status).toBe(400);
    expect((await post(chair, '/meetings', { ...ok, participantIds: ['00000000-0000-4000-8000-000000000000'] })).body.message).toBe('USER_NOT_FOUND');
    expect((await post(chair, '/meetings', { ...ok, projectId: '00000000-0000-4000-8000-000000000000' })).body.message).toBe('PROJECT_NOT_FOUND');
  });
});

describe('decisions and instructions', () => {
  it('an instruction needs a responsible participant and a date; a decision has neither', async () => {
    const { sec, anna, outsider, meeting } = await setup();
    const url = `/meetings/${meeting.id}/items/${meeting.items[0].id}/resolutions`;
    expect((await post(sec, url, { kind: 'INSTRUCTION', text: 'Разослать' })).body.message).toBe('RESPONSIBLE_REQUIRED');
    expect((await post(sec, url, { kind: 'INSTRUCTION', text: 'Разослать', responsibleId: anna.id })).body.message).toBe('DUE_REQUIRED');
    expect((await post(sec, url, { kind: 'INSTRUCTION', text: 'Разослать', responsibleId: outsider.id, due: '2026-11-01' })).body.message).toBe('RESPONSIBLE_NOT_IN_MEETING');
    expect((await post(sec, url, { kind: 'INSTRUCTION', text: 'Разослать', responsibleId: anna.id, due: '2026-02-31' })).body.message).toBe('INVALID_DATE');
    expect((await post(sec, url, { kind: 'DECISION', text: 'Принять', responsibleId: anna.id })).body.message).toBe('DECISION_HAS_NO_RESPONSIBLE');
    expect((await post(sec, url, { kind: 'DECISION' })).body.message).toBe('TEXT_REQUIRED');
    const ok = await post(sec, url, { kind: 'INSTRUCTION', text: 'Разослать', responsibleId: anna.id, due: '2026-11-01' });
    expect(ok.status).toBe(201);
    expect(ok.body.items[0].resolutions[0]).toMatchObject({ kind: 'INSTRUCTION', responsibleId: anna.id, due: '2026-11-01' });
    // the person with an instruction cannot be dropped from the meeting
    expect((await del(sec, `/meetings/${meeting.id}/participants/${anna.id}`)).body.message).toBe('PARTICIPANT_HAS_INSTRUCTIONS');
  });

  it('takes over a decision that was made in the meeting chat', async () => {
    const { sec, chair, anna, boris, outsider, meeting } = await setup();
    const msg = (await post(chair, `/chats/${meeting.chatId}/messages`, { body: 'Предлагаю утвердить реестр' })).body;
    const decision = (await post(chair, `/chats/${meeting.chatId}/messages/${msg.id}/decision`, { text: 'Утвердить реестр поставщиков', addresseeIds: [anna.id, boris.id] })).body;
    const view = (await get(sec, `/meetings/${meeting.id}`)).body;
    expect(view.chatDecisions).toEqual([{ id: decision.id, text: 'Утвердить реестр поставщиков', status: 'PENDING' }]);
    const url = `/meetings/${meeting.id}/items/${meeting.items[0].id}/resolutions`;
    const linked = await post(sec, url, { kind: 'DECISION', decisionId: decision.id });
    expect(linked.body.items[0].resolutions[0]).toMatchObject({ text: 'Утвердить реестр поставщиков', decisionId: decision.id });
    // a decision from some other chat is not the meeting's
    const other = (await post(outsider, '/chats/direct', { userId: anna.id })).body;
    const m2 = (await post(outsider, `/chats/${other.id}/messages`, { body: 'x' })).body;
    const foreign = (await post(outsider, `/chats/${other.id}/messages/${m2.id}/decision`, { text: 'Чужое', addresseeIds: [anna.id] })).body;
    expect((await post(sec, url, { kind: 'DECISION', decisionId: foreign.id })).body.message).toBe('DECISION_NOT_IN_MEETING');
    expect((await post(sec, url, { kind: 'INSTRUCTION', decisionId: decision.id, responsibleId: anna.id, due: '2026-11-01' })).body.message).toBe('DECISION_LINK_ONLY_FOR_DECISIONS');
  });
});

describe('the protocol (П-3.5.1)', () => {
  /** 3 agenda points, 2 decisions and 3 instructions, as in the acceptance scenario. */
  async function recorded() {
    const s = await setup();
    const { sec, anna, boris, meeting } = s;
    const [i1, i2] = meeting.items.map((i) => i.id);
    const res = (item: string, body: object) => post(sec, `/meetings/${meeting.id}/items/${item}/resolutions`, body).expect(201);
    await patch(sec, `/meetings/${meeting.id}/items/${i1}`, { heard: 'Доклад о новых поставщиках' }).expect(200);
    await res(i1, { kind: 'DECISION', text: 'Утвердить реестр поставщиков' });
    await res(i1, { kind: 'INSTRUCTION', text: 'Разослать реестр отделам', responsibleId: anna.id, due: '2026-11-01' });
    await res(i2, { kind: 'DECISION', text: 'Принять график отпусков' });
    await res(i2, { kind: 'INSTRUCTION', text: 'Подготовить приказ об отпусках', responsibleId: boris.id, due: '2026-11-05' });
    await res(i2, { kind: 'INSTRUCTION', text: 'Ознакомить сотрудников', responsibleId: anna.id, due: '2026-11-10' });
    return s;
  }

  it('is made from the record: every point, decision and instruction, in a Word file that fills in cleanly', async () => {
    const { sec, meeting } = await recorded();
    const made = await post(sec, `/meetings/${meeting.id}/protocol`, { lang: 'ru' });
    expect(made.status).toBe(200);
    const docId = made.body.documentId as string;
    expect(made.body.meeting).toMatchObject({ protocolId: docId, protocolStatus: 'DRAFT' });

    const doc = (await get(sec, `/documents/${docId}`)).body;
    expect(doc).toMatchObject({ status: 'DRAFT', lang: 'ru', docDate: '2026-10-15', authorId: sec.id });
    expect(doc.title).toBe('Протокол совещания «Планёрка по закупкам» от 15.10.2026');
    const file = await get(sec, `/documents/${docId}/file?format=docx`).buffer(true).parse(buffer);
    const text = docxText(file.body as Buffer);
    for (const must of [
      'ПРОТОКОЛ № ______', 'Председатель: User chair', 'Секретарь: User sec', 'User anna', 'User boris',
      '1. Реестр поставщиков', '2. График отпусков', '3. Разное', 'Слушали: Доклад о новых поставщиках',
      'Утвердить реестр поставщиков (п. 1 повестки)', 'Принять график отпусков (п. 2 повестки)',
      'Разослать реестр отделам (п. 1 повестки) (ответственный: User anna; срок: 01.11.2026)',
      'Подготовить приказ об отпусках (п. 2 повестки) (ответственный: User boris; срок: 05.11.2026)',
      'Ознакомить сотрудников (п. 2 повестки) (ответственный: User anna; срок: 10.11.2026)',
    ]) expect(text).toContain(must);
    expect(text).not.toMatch(/[{}]/);
  });

  it('can be made in Kazakh, and refreshed after the record changes', async () => {
    const { sec, meeting } = await recorded();
    const first = await post(sec, `/meetings/${meeting.id}/protocol`, { lang: 'ru' });
    const docId = first.body.documentId;
    await post(sec, `/meetings/${meeting.id}/items`, { title: 'Ещё вопрос' }).expect(201);
    const again = await post(sec, `/meetings/${meeting.id}/protocol`, { lang: 'kk' });
    expect(again.body.documentId).toBe(docId); // the same document, not a second one
    expect(await prisma.document.count()).toBe(1);
    const doc = (await get(sec, `/documents/${docId}`)).body;
    expect(doc.lang).toBe('kk');
    expect(doc.title).toContain('кеңесінің хаттамасы');
    expect(doc.data.agenda).toHaveLength(4);
    const text = docxText((await get(sec, `/documents/${docId}/file?format=docx`).buffer(true).parse(buffer)).body as Buffer);
    expect(text).toContain('ХАТТАМА');
    expect(text).toContain('Тыңдалды');
  });

  it('goes through approval and registration like any document; then the record is locked', async () => {
    const { sec, chair, meeting } = await recorded();
    const law = await person('law');
    const docId = (await post(sec, `/meetings/${meeting.id}/protocol`, { lang: 'ru' })).body.documentId as string;
    // the author of the protocol is the one who made it; a colleague's route:
    await post(sec, `/documents/${docId}/submit`, { route: [{ approverId: law.id }] }).expect(200);
    expect((await get(sec, `/meetings/${meeting.id}`)).body.protocolStatus).toBe('IN_REVIEW');
    expect((await post(sec, `/meetings/${meeting.id}/items`, { title: 'Поздно' })).body.message).toBe('PROTOCOL_LOCKED');
    expect((await post(chair, `/meetings/${meeting.id}/protocol`, { lang: 'ru' })).body.message).toBe('PROTOCOL_LOCKED');

    // returned: the record can be corrected again, and the protocol refreshed
    await post(law, `/documents/${docId}/return`, { comment: 'Уточните сроки' }).expect(200);
    expect((await post(sec, `/meetings/${meeting.id}/items`, { title: 'После возврата' })).status).toBe(201);
    await post(sec, `/meetings/${meeting.id}/protocol`, { lang: 'ru' }).expect(200);
    await post(sec, `/documents/${docId}/submit`).expect(200);
    await post(law, `/documents/${docId}/approve`).expect(200);
    expect((await get(sec, `/documents/${docId}`)).body.status).toBe('APPROVED');
  });

  it('only the organisers make it', async () => {
    const { anna, outsider, meeting } = await recorded();
    expect((await post(anna, `/meetings/${meeting.id}/protocol`, { lang: 'ru' })).status).toBe(403);
    expect((await post(outsider, `/meetings/${meeting.id}/protocol`, { lang: 'ru' })).status).toBe(404);
    expect((await post(anna, `/meetings/${meeting.id}/protocol`, { lang: 'de' })).status).toBe(400);
    expect(await prisma.document.count()).toBe(0);
  });
});
