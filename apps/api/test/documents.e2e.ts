import { createHash } from 'crypto';
import { INestApplication } from '@nestjs/common';
import PizZip from 'pizzip';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildDocx } from '../src/documents/docx-builder';
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

const kindId = async (code: string) => (await prisma.documentKind.findUniqueOrThrow({ where: { code } })).id;
async function draft(p: P, code = 'ORDER', extra: object = {}) {
  const res = await post(p, '/documents', { kindId: await kindId(code), lang: 'ru', title: 'Об утверждении графика', data: { preamble: 'В целях упорядочения работы', items: [{ text: 'Утвердить график', responsible: 'Борис', due: '2026-12-01' }] }, ...extra });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}
const download = (p: P, id: string, format: 'docx' | 'pdf') =>
  http().get(`/api/documents/${id}/file?format=${format}`).set(bearer(p.token)).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

describe('kinds and built-in templates', () => {
  it('ships protocol, order, memo and directive, each with a Russian and a Kazakh template', async () => {
    const kinds = (await get(await person('anna'), '/document-kinds')).body;
    expect(kinds.map((k: { code: string }) => k.code).sort()).toEqual(['DIRECTIVE', 'MEMO', 'ORDER', 'PROTOCOL']);
    expect(await prisma.documentTemplate.count()).toBe(8);
    // asking again changes nothing
    await seedDocuments(app);
    expect(await prisma.documentTemplate.count()).toBe(8);
  });

  it('only the secretary (or an administrator) maintains kinds; prefixes are checked', async () => {
    const anna = await person('anna');
    const sec = await person('sec', ['SECRETARY']);
    const body = { nameRu: 'Акт', nameKk: 'Акт', prefix: 'А' };
    expect((await post(anna, '/document-kinds', body)).status).toBe(403);
    const made = await post(sec, '/document-kinds', body);
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ prefix: 'А', isActive: true });
    for (const bad of ['', 'AB/C', '123456789', 'a b']) expect((await post(sec, '/document-kinds', { ...body, prefix: bad })).status).toBe(400);
    expect((await patch(sec, `/document-kinds/${made.body.id}`, { isActive: false })).body.isActive).toBe(false);
    // an inactive kind is hidden from the list people choose from, and cannot be used
    expect((await get(anna, '/document-kinds')).body.map((k: { id: string }) => k.id)).not.toContain(made.body.id);
    expect((await post(anna, '/documents', { kindId: made.body.id, lang: 'ru', title: 'x', data: {} })).status).toBe(404);
  });
});

describe('drafts', () => {
  it('anyone drafts a document; only the author, the secretary and management can see it', async () => {
    const anna = await person('anna');
    const boris = await person('boris');
    const sec = await person('sec', ['SECRETARY']);
    const director = await person('director', ['MANAGEMENT']);
    const d = await draft(anna);
    expect((await get(anna, `/documents/${d.id}`)).body).toMatchObject({ status: 'DRAFT', authorId: anna.id, registrationNumber: null });
    expect((await get(boris, `/documents/${d.id}`)).status).toBe(404);
    expect((await get(boris, '/documents')).body).toEqual([]);
    expect((await get(sec, `/documents/${d.id}`)).status).toBe(200);
    expect((await get(director, '/documents')).body).toHaveLength(1);
    expect((await download(boris, d.id, 'docx')).status).toBe(404);
  });

  it('checks the input', async () => {
    const anna = await person('anna');
    const k = await kindId('ORDER');
    const ok = { kindId: k, lang: 'ru', title: 'T', data: {} };
    expect((await post(anna, '/documents', { ...ok, title: '   ' })).status).toBe(400);
    expect((await post(anna, '/documents', { ...ok, lang: 'de' })).status).toBe(400);
    expect((await post(anna, '/documents', { ...ok, docDate: '2026-02-31' })).body.message).toBe('INVALID_DATE');
    expect((await post(anna, '/documents', { ...ok, data: { items: [{ text: '' }] } })).status).toBe(400);
    expect((await post(anna, '/documents', { ...ok, data: { surprise: 1 } })).status).toBe(400);
  });

  it('only the author edits, and only while it is a draft or returned', async () => {
    const anna = await person('anna');
    const sec = await person('sec', ['SECRETARY']);
    const d = await draft(anna);
    expect((await patch(sec, `/documents/${d.id}`, { title: 'Чужой' })).status).toBe(403);
    expect((await patch(anna, `/documents/${d.id}`, { title: 'Новое название' })).body.title).toBe('Новое название');
    await prisma.document.update({ where: { id: d.id }, data: { status: 'IN_REVIEW' } });
    expect((await patch(anna, `/documents/${d.id}`, { title: 'Поздно' })).body.message).toBe('DOCUMENT_LOCKED');
    await prisma.document.update({ where: { id: d.id }, data: { status: 'RETURNED' } });
    expect((await patch(anna, `/documents/${d.id}`, { title: 'После возврата' })).status).toBe(200);
  });
});

describe('files', () => {
  it('produces a Word file with the text, a blank number and the Russian layout', async () => {
    const anna = await person('anna');
    const d = await draft(anna);
    const res = await download(anna, d.id, 'docx');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('wordprocessingml.document');
    expect(res.headers['content-disposition']).toContain('attachment');
    const text = docxText(res.body as Buffer);
    for (const must of ['Об утверждении графика', 'ПРИКАЗ № ______', 'В целях упорядочения работы', 'Утвердить график (ответственный: Борис; срок: 01.12.2026)']) expect(text).toContain(must);
  });

  it('writes a Kazakh document from the Kazakh template', async () => {
    const anna = await person('anna');
    const d = await draft(anna, 'ORDER', { lang: 'kk' });
    const text = docxText((await download(anna, d.id, 'docx')).body as Buffer);
    expect(text).toContain('БҰЙРЫҚ');
    expect(text).toContain('БҰЙЫРАМЫН');
  });

  it('makes a real PDF, keeps its hash, and serves the same bytes again', async () => {
    const anna = await person('anna');
    const d = await draft(anna);
    const pdf = await download(anna, d.id, 'pdf');
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const bytes = pdf.body as Buffer;
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const doc = (await get(anna, `/documents/${d.id}`)).body;
    expect(doc.pdfSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    const again = (await download(anna, d.id, 'pdf')).body as Buffer;
    expect(again.equals(bytes)).toBe(true); // not regenerated
  }, 120_000);

  it('editing the text throws the old files away', async () => {
    const anna = await person('anna');
    const d = await draft(anna);
    await download(anna, d.id, 'docx');
    const before = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
    expect(before.docxKey).toBeTruthy();
    await patch(anna, `/documents/${d.id}`, { data: { body: 'Совершенно новый текст' } }).expect(200);
    const cleared = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
    expect(cleared.docxKey).toBeNull();
    expect(cleared.pdfSha256).toBeNull();
    expect(docxText((await download(anna, d.id, 'docx')).body as Buffer)).toContain('Совершенно новый текст');
  });

  it('shows hostile text literally instead of acting on it', async () => {
    const anna = await person('anna');
    const evil = '<w:p>&{#items}{/items}{x}';
    const d = await draft(anna, 'MEMO', { title: evil });
    expect(docxText((await download(anna, d.id, 'docx')).body as Buffer)).toContain(evil);
  });
});

describe('templates', () => {
  const upload = (p: P, kind: string, lang: string, file: Buffer, name = 'шаблон.docx') =>
    http().post('/api/document-templates').set(bearer(p.token)).field('kindId', kind).field('lang', lang).attach('file', file, { filename: name });

  it('the secretary uploads a Word template; it becomes version 2 and is used for new files', async () => {
    const anna = await person('anna');
    const sec = await person('sec', ['SECRETARY']);
    const k = await kindId('MEMO');
    const mine = buildDocx([{ text: 'СВОЙ БЛАНК ЦЕНТРА: {title} / {number} / {author}' }]);
    expect((await upload(anna, k, 'ru', mine)).status).toBe(403);
    const up = await upload(sec, k, 'ru', mine);
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ version: 2, lang: 'ru', isActive: true });

    const d = await draft(anna, 'MEMO', { title: 'Просьба' });
    const text = docxText((await download(anna, d.id, 'docx')).body as Buffer);
    expect(text).toContain('СВОЙ БЛАНК ЦЕНТРА: Просьба / ______ / User anna');
    // the Kazakh template is untouched
    const kk = await draft(anna, 'MEMO', { lang: 'kk' });
    expect(docxText((await download(anna, kk.id, 'docx')).body as Buffer)).toContain('ҚЫЗМЕТТІК ХАТ');

    // the secretary can take the current file back to edit it in Word
    const back = await http().get(`/api/document-templates/${up.body.id}/file`).set(bearer(sec.token)).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(docxText(back.body as Buffer)).toContain('СВОЙ БЛАНК ЦЕНТРА');
    expect((await get(anna, `/document-templates/${up.body.id}/file`)).status).toBe(403);
  });

  it('rejects files that are not usable templates, with the reason, and keeps the old version', async () => {
    const sec = await person('sec', ['SECRETARY']);
    const k = await kindId('ORDER');
    const bad = await upload(sec, k, 'ru', Buffer.from('это не Word'));
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('TEMPLATE_INVALID');
    expect(bad.body.details.length).toBeGreaterThan(0);
    const unclosed = await upload(sec, k, 'ru', buildDocx([{ text: '{#items}без конца' }]));
    expect(unclosed.body.message).toBe('TEMPLATE_INVALID');
    expect((await upload(sec, k, 'de', buildDocx([{ text: 'x' }]))).status).toBe(400);
    expect(await prisma.documentTemplate.count({ where: { kindId: k, lang: 'ru' } })).toBe(1);
  });
});
