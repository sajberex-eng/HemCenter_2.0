import { createHash } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  process.env.PDF_ENABLED = 'false'; // the production default: Word only
});
afterEach(() => {
  process.env.PDF_ENABLED = 'true'; // the rest of the suite exercises PDF
});

async function person(login: string, roles: ('EMPLOYEE' | 'SECRETARY')[] = ['EMPLOYEE']) {
  const u = await makeUser(login, roles);
  return { id: u.id, token: (await loginAs(app, login)).body.accessToken as string };
}
type P = Awaited<ReturnType<typeof person>>;
const get = (p: P, url: string) => http().get(`/api${url}`).set(bearer(p.token));
const post = (p: P, url: string, body: object = {}) => http().post(`/api${url}`).set(bearer(p.token)).send(body);
const bytes = (p: P, url: string) =>
  get(p, url).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

describe('Word-only mode (PDF_ENABLED off)', () => {
  it('has no PDF; registration fixes the hash of the final Word file, which is what is downloaded', async () => {
    const sec = await person('sec', ['SECRETARY']);
    const law = await person('law');
    const kind = await prisma.documentKind.findUniqueOrThrow({ where: { code: 'ORDER' } });
    const id = (await post(sec, '/documents', { kindId: kind.id, lang: 'ru', title: 'Об утверждении графика', data: { body: 'Утвердить график.' } })).body.id as string;

    // no PDF at all, and the page is told so
    expect((await get(sec, `/documents/${id}`)).body.pdfEnabled).toBe(false);
    const refused = await get(sec, `/documents/${id}/file?format=pdf`);
    expect(refused.status).toBe(404);
    expect(refused.body.message).toBe('PDF_DISABLED');
    expect((await get(sec, `/documents/${id}`)).body.docxSha256).toBeNull(); // not final yet

    await post(sec, `/documents/${id}/submit`, { route: [{ approverId: law.id }] }).expect(200);
    await post(law, `/documents/${id}/approve`).expect(200);
    await http().post(`/api/documents/${id}/scan`).set(bearer(sec.token)).attach('file', Buffer.from('%PDF-1.4\n% scan\n'), { filename: 'scan.pdf' }).expect(200);
    const reg = await post(sec, `/documents/${id}/register`);
    expect(reg.status).toBe(200);

    const doc = (await get(sec, `/documents/${id}`)).body;
    expect(doc.status).toBe('REGISTERED');
    expect(doc.pdfSha256).toBeNull();
    expect(doc.docxSha256).toMatch(/^[0-9a-f]{64}$/);
    const word = await bytes(sec, `/documents/${id}/file?format=docx`);
    expect(word.status).toBe(200);
    expect(createHash('sha256').update(word.body as Buffer).digest('hex')).toBe(doc.docxSha256);
    expect((await prisma.document.findUniqueOrThrow({ where: { id } })).pdfKey).toBeNull();
  }, 60_000);
});
