import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { todayIn } from '../src/projects/project-rules';
import { bearer, createApp, loginAs, makeUser, prisma, resetDb, seedDocuments } from './helpers';
import { docxText } from './docx-text';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const YEAR = todayIn().slice(0, 4);

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

const kindId = async (code: string) => (await prisma.documentKind.findUniqueOrThrow({ where: { code } })).id;
async function draft(p: P, code = 'ORDER', title = 'О командировке') {
  const res = await post(p, '/documents', { kindId: await kindId(code), lang: 'ru', title, data: { preamble: 'В связи с производственной необходимостью', items: [{ text: 'Направить сотрудника', responsible: 'Борис' }], signer: 'Директор' } });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
const buffer = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const download = (p: P, id: string, format: 'docx' | 'pdf') => http().get(`/api/documents/${id}/file?format=${format}`).set(bearer(p.token)).buffer(true).parse(buffer);
const pdfScan = Buffer.from('%PDF-1.4\n% scanned signed copy\n');

/** Sends a document along "one approver" and approves it. */
async function approved(author: P, approver: P, code = 'ORDER') {
  const id = await draft(author, code);
  await post(author, `/documents/${id}/submit`, { route: [{ approverId: approver.id }] }).expect(200);
  await post(approver, `/documents/${id}/approve`).expect(200);
  return id;
}
async function signed(author: P, approver: P, code = 'ORDER') {
  const id = await approved(author, approver, code);
  const up = await http().post(`/api/documents/${id}/scan`).set(bearer(author.token)).attach('file', pdfScan, { filename: 'scan.pdf' });
  expect(up.status).toBe(200);
  return id;
}

describe('approval route (П-3.6.1)', () => {
  it('lawyer → accountant in parallel → director: a return, a correction, and the whole history on the sheet', async () => {
    const sec = await person('sec', ['SECRETARY']);
    const law = await person('law');
    const acc = await person('acc');
    const dir = await person('dir');
    const id = await draft(sec);

    const sent = await post(sec, `/documents/${id}/submit`, { route: [{ approverId: law.id }, { approverId: acc.id, parallelWithPrevious: true }, { approverId: dir.id }] });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ status: 'IN_REVIEW', round: 1 });
    expect(sent.body.steps.map((s: { stage: number }) => s.stage)).toEqual([1, 1, 2]);

    // the director's turn has not come
    expect((await post(dir, `/documents/${id}/approve`)).body.message).toBe('NOT_YOUR_TURN');
    expect((await get(law, '/documents?awaiting=1')).body.map((d: { id: string }) => d.id)).toEqual([id]);
    expect((await get(dir, '/documents?awaiting=1')).body).toEqual([]);

    // the lawyer returns it, and a reason is required
    expect((await post(law, `/documents/${id}/return`)).body.message).toBe('COMMENT_REQUIRED');
    expect((await post(law, `/documents/${id}/return`, { comment: '   ' })).body.message).toBe('COMMENT_REQUIRED');
    const returned = await post(law, `/documents/${id}/return`, { comment: 'Не указано основание' });
    expect(returned.body.status).toBe('RETURNED');
    // the round is over for everybody
    expect((await post(acc, `/documents/${id}/approve`)).body.message).toBe('NOT_UNDER_REVIEW');

    // the author corrects the text and sends it again along the same route
    await patch(sec, `/documents/${id}`, { data: { preamble: 'На основании приказа №1', signer: 'Директор' } }).expect(200);
    const again = await post(sec, `/documents/${id}/submit`);
    expect(again.body).toMatchObject({ status: 'IN_REVIEW', round: 2 });
    expect(again.body.steps.map((s: { status: string }) => s.status)).toEqual(['PENDING', 'PENDING', 'PENDING']);

    await post(law, `/documents/${id}/approve`, { comment: 'Замечания учтены' }).expect(200);
    expect((await post(law, `/documents/${id}/approve`)).body.message).toBe('ALREADY_DECIDED');
    const mid = await post(acc, `/documents/${id}/approve`);
    expect(mid.body.status).toBe('IN_REVIEW'); // the director is still to come
    const done = await post(dir, `/documents/${id}/approve`);
    expect(done.body.status).toBe('APPROVED');

    expect(done.body.actions.map((a: { kind: string; round: number }) => `${a.round}:${a.kind}`)).toEqual(['1:SUBMIT', '1:RETURN', '2:SUBMIT', '2:APPROVE', '2:APPROVE', '2:APPROVE']);
    const sheet = docxText((await download(sec, id, 'docx')).body as Buffer);
    for (const must of ['Лист согласования', 'User law — возвращено с замечаниями', 'Не указано основание', 'User law — согласовано', 'Замечания учтены', 'User acc — согласовано', 'User dir — согласовано']) expect(sheet).toContain(must);
    // everything is also in the audit log
    expect(await prisma.auditLog.count({ where: { action: { in: ['document.submitted', 'document.approved', 'document.returned'] } } })).toBe(6);
  });

  it('the author cannot approve; only people in the route can act; strangers do not see the document', async () => {
    const sec = await person('sec', ['SECRETARY']);
    const law = await person('law');
    const other = await person('other');
    const id = await draft(sec);
    await post(sec, `/documents/${id}/submit`, { route: [{ approverId: law.id }] }).expect(200);
    expect((await post(sec, `/documents/${id}/approve`)).body.message).toBe('NOT_AN_APPROVER');
    expect((await post(other, `/documents/${id}/approve`)).status).toBe(404);
    expect((await get(other, `/documents/${id}`)).status).toBe(404);
    expect((await get(law, `/documents/${id}`)).status).toBe(200); // the approver sees what they approve
    expect((await patch(law, `/documents/${id}`, { title: 'Правка' })).status).toBe(403);
    expect((await patch(sec, `/documents/${id}`, { title: 'Поздно' })).body.message).toBe('DOCUMENT_LOCKED');
  });

  it('checks the route', async () => {
    const sec = await person('sec', ['SECRETARY']);
    const law = await person('law');
    const id = await draft(sec);
    const send = (route: object[] | undefined) => post(sec, `/documents/${id}/submit`, route ? { route } : {});
    expect((await send(undefined)).body.message).toBe('ROUTE_REQUIRED'); // a draft has no old route
    expect((await send([])).body.message).toBe('ROUTE_REQUIRED');
    expect((await send([{ approverId: sec.id }])).body.message).toBe('APPROVER_IS_AUTHOR');
    expect((await send([{ approverId: law.id }, { approverId: law.id }])).body.message).toBe('DUPLICATE_APPROVER');
    expect((await send([{ approverId: '00000000-0000-4000-8000-000000000000' }])).body.message).toBe('USER_NOT_FOUND');
    expect((await send([{ approverId: 'nope' }])).status).toBe(400);
    expect((await get(sec, `/documents/${id}`)).body.status).toBe('DRAFT');
    // only the author sends
    expect((await post(law, `/documents/${id}/submit`, { route: [{ approverId: sec.id }] })).status).toBe(404);
  });

  it('approvers deciding at the same moment are handled one after the other (nothing gets stuck "in review")', async () => {
    const sec = await person('sec', ['SECRETARY']);
    const a = await person('a');
    const b = await person('b');
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = await draft(sec, 'ORDER', `Документ ${i}`);
      await post(sec, `/documents/${id}/submit`, { route: [{ approverId: a.id }, { approverId: b.id, parallelWithPrevious: true }] }).expect(200);
      ids.push(id);
    }
    // sixteen decisions at once, two on every document
    const results = await Promise.all(ids.flatMap((id) => [post(a, `/documents/${id}/approve`), post(b, `/documents/${id}/approve`)]));
    expect(results.map((r) => r.status)).toEqual(Array(16).fill(200));
    for (const id of ids) expect((await get(sec, `/documents/${id}`)).body.status).toBe('APPROVED');
  });

  it('shows how many documents wait for me', async () => {
    const sec = await person('sec', ['SECRETARY']);
    const law = await person('law');
    for (const t of ['Один', 'Два']) await post(sec, `/documents/${await draft(sec, 'ORDER', t)}/submit`, { route: [{ approverId: law.id }] });
    expect((await get(law, '/documents/awaiting-count')).body).toEqual({ count: 2 });
    expect((await get(sec, '/documents/awaiting-count')).body).toEqual({ count: 0 });
  });
});

describe('scan and registration (П-3.6.2)', () => {
  it('the paper copy is attached only to an approved document, as a PDF or a photo', async () => {
    const sec = await person('sec', ['SECRETARY']);
    const law = await person('law');
    const other = await person('other');
    const id = await draft(sec);
    const scan = (p: P, data: Buffer, name = 'scan.pdf') => http().post(`/api/documents/${id}/scan`).set(bearer(p.token)).attach('file', data, { filename: name });
    expect((await scan(sec, pdfScan)).body.message).toBe('NOT_READY_FOR_SCAN'); // still a draft
    await post(sec, `/documents/${id}/submit`, { route: [{ approverId: law.id }] });
    await post(law, `/documents/${id}/approve`);
    expect((await scan(sec, Buffer.from('MZ not a scan'), 'virus.pdf')).body.message).toBe('SCAN_TYPE_NOT_ALLOWED');
    expect((await scan(sec, Buffer.alloc(0))).status).toBe(400);
    expect((await scan(other, pdfScan)).status).toBe(404);
    expect((await scan(law, pdfScan)).status).toBe(403); // an approver is not the keeper of the paper

    const ok = await scan(sec, pdfScan);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('SIGNED');
    expect(ok.body.scan).toMatchObject({ name: 'scan.pdf', size: pdfScan.length });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    expect((await scan(sec, png, 'photo.png')).body.scan.name).toBe('photo.png'); // replaced while not yet registered
    const back = await http().get(`/api/documents/${id}/scan`).set(bearer(law.token)).buffer(true).parse(buffer);
    expect(back.status).toBe(200);
    expect((back.body as Buffer).equals(png)).toBe(true);
    expect((await get(other, `/documents/${id}/scan`)).status).toBe(404);
  });

  it('consecutive registrations get consecutive numbers; a document cannot be registered twice', async () => {
    const sec = await person('sec', ['SECRETARY']);
    const law = await person('law');
    const first = await signed(sec, law);
    const second = await signed(sec, law);
    const r1 = await post(sec, `/documents/${first}/register`);
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ status: 'REGISTERED', registrationNumber: `1-ПР/${YEAR}` });
    expect((await post(sec, `/documents/${second}/register`)).body.registrationNumber).toBe(`2-ПР/${YEAR}`);
    expect((await post(sec, `/documents/${first}/register`)).body.message).toBe('ALREADY_REGISTERED');
    expect((await get(sec, `/documents/${first}`)).body.registrationNumber).toBe(`1-ПР/${YEAR}`);
    // another kind has its own journal
    const memo = await signed(sec, law, 'MEMO');
    expect((await post(sec, `/documents/${memo}/register`)).body.registrationNumber).toBe(`1-СЗ/${YEAR}`);
  });

  it('simultaneous registrations never share or skip a number', async () => {
    const sec = await person('sec', ['SECRETARY']);
    const law = await person('law');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await signed(sec, law));
    const results = await Promise.all(ids.map((id) => post(sec, `/documents/${id}/register`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const numbers = results.map((r) => r.body.registrationNumber as string).sort();
    expect(numbers).toEqual([1, 2, 3, 4, 5].map((n) => `${n}-ПР/${YEAR}`));
    // the same document twice at once: exactly one wins
    const extra = await signed(sec, law);
    const dup = await Promise.all([post(sec, `/documents/${extra}/register`), post(sec, `/documents/${extra}/register`)]);
    expect(dup.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await prisma.registryCounter.findMany()).map((c) => c.last)).toEqual([6]);
  });

  it('only the secretary registers, and only a signed document', async () => {
    const sec = await person('sec', ['SECRETARY']);
    const law = await person('law');
    const author = await person('author');
    const id = await approved(author, law);
    expect((await post(author, `/documents/${id}/register`)).status).toBe(403);
    expect((await post(sec, `/documents/${id}/register`)).body.message).toBe('NOT_READY_FOR_REGISTRATION'); // approved but no scan yet
    const draftId = await draft(author);
    expect((await post(sec, `/documents/${draftId}/register`)).body.message).toBe('NOT_READY_FOR_REGISTRATION');
    expect(await prisma.registryCounter.count()).toBe(0);
  });

  it('the registered document carries its number in the files, with a fixed PDF and hash', async () => {
    const sec = await person('sec', ['SECRETARY']);
    const law = await person('law');
    const id = await signed(sec, law);
    const reg = await post(sec, `/documents/${id}/register`);
    expect(reg.body.pdfSha256).toMatch(/^[0-9a-f]{64}$/); // made right at registration
    expect(docxText((await download(sec, id, 'docx')).body as Buffer)).toContain(`ПРИКАЗ № 1-ПР/${YEAR}`);
    const pdf = (await download(sec, id, 'pdf')).body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await patch(sec, `/documents/${id}`, { title: 'Задним числом' })).body.message).toBe('DOCUMENT_LOCKED');
    // and the kind's letters can no longer change under the printed numbers
    const k = await kindId('ORDER');
    expect((await patch(sec, `/document-kinds/${k}`, { prefix: 'ПРИК' })).body.message).toBe('PREFIX_LOCKED');
    expect((await patch(sec, `/document-kinds/${k}`, { nameRu: 'Приказ' })).status).toBe(200);
  }, 120_000);
});
