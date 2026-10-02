import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createEmployee, EMPLOYEE_PASSWORD, nav, openAs, type Person } from './helpers';

async function token(request: APIRequestContext, p: Person) {
  return (await (await request.post('/api/auth/login', { data: { login: p.login, password: EMPLOYEE_PASSWORD } })).json()).accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const PDF = Buffer.from('%PDF-1.4\n% signed paper copy\n');

/** An order drafted by API (the writing form is covered in documents.spec.ts). */
async function draftOrder(request: APIRequestContext, author: Person, title: string) {
  const t = await token(request, author);
  const kinds = (await (await request.get('/api/document-kinds', { headers: auth(t) })).json()) as { id: string; code: string }[];
  const res = await request.post('/api/documents', { headers: auth(t), data: { kindId: kinds.find((k) => k.code === 'ORDER')!.id, lang: 'ru', title, data: { preamble: 'В связи с производственной необходимостью', signer: 'Директор' } } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const status = (page: Page) => page.getByTestId('document-status');
const pick = async (page: Page, n: number, person: Person) => page.getByLabel(`Согласующий ${n}`, { exact: true }).selectOption({ value: person.id });

test.describe('approval route and registration (П-3.6.1, П-3.6.2)', () => {
  test('lawyer → accountant (together) → director: returned once, corrected, approved, signed on paper, registered', async ({ browser, request }, info) => {
    const sec = await createEmployee(request, 'sec', info, ['SECRETARY']);
    const law = await createEmployee(request, 'law', info);
    const acc = await createEmployee(request, 'acc', info);
    const dir = await createEmployee(request, 'dir', info);
    const id = await draftOrder(request, sec, 'О порядке закупок');

    const s = await openAs(browser, sec, info);
    await s.page.goto(`/documents/${id}`);
    await expect(status(s.page)).toHaveText('Черновик');
    await s.page.getByRole('button', { name: 'Добавить согласующего' }).click();
    await s.page.getByRole('button', { name: 'Добавить согласующего' }).click();
    await s.page.getByRole('button', { name: 'Добавить согласующего' }).click();
    await pick(s.page, 1, law);
    await pick(s.page, 2, acc);
    await s.page.getByRole('checkbox', { name: 'Одновременно с предыдущим' }).first().check();
    await pick(s.page, 3, dir);
    await s.page.getByRole('button', { name: 'Отправить на согласование' }).click();
    await expect(status(s.page)).toHaveText('На согласовании');
    await expect(s.page.getByTestId('step')).toHaveCount(3);

    // the lawyer is told, and returns it: a reason is demanded
    const l = await openAs(browser, law, info);
    await l.page.goto('/documents');
    await expect(nav(l.page).getByRole('link', { name: /Документы/ }).getByLabel('1')).toBeVisible(); // the badge in the menu
    await l.page.getByRole('button', { name: 'Ждут моего решения' }).click();
    await l.page.getByTestId('document-item').filter({ hasText: 'О порядке закупок' }).click();
    await expect(l.page.getByTestId('decide')).toContainText('Ваша очередь');
    await l.page.getByRole('button', { name: 'Вернуть с замечаниями' }).click();
    await expect(l.page.locator('p[role="alert"]')).toHaveText('Укажите замечания.');
    await l.page.getByLabel('Комментарий').fill('Не указано основание');
    await l.page.getByRole('button', { name: 'Вернуть с замечаниями' }).click();
    await expect(status(l.page)).toHaveText('Возвращён на доработку');
    await expect(l.page.getByTestId('decide')).toHaveCount(0);

    // the secretary's open page changed by itself; she sends it again along the same route
    await expect(status(s.page)).toHaveText('Возвращён на доработку');
    await expect(s.page.getByTestId('steps')).toContainText('Не указано основание');
    await s.page.getByRole('button', { name: 'Отправить повторно' }).click();
    await expect(status(s.page)).toHaveText('На согласовании');

    // the director cannot go first; the others decide, then the director
    const d = await openAs(browser, dir, info);
    await d.page.goto(`/documents/${id}`);
    await expect(d.page.getByTestId('decide')).toHaveCount(0);

    await l.page.reload();
    await l.page.getByRole('button', { name: 'Согласовать' }).click();
    await expect(l.page.getByTestId('decide')).toHaveCount(0);
    const a = await openAs(browser, acc, info);
    await a.page.goto(`/documents/${id}`);
    await a.page.getByRole('button', { name: 'Согласовать' }).click();
    await expect(a.page.getByTestId('step').filter({ hasText: acc.fullName })).toContainText('Согласовал');
    await expect(d.page.getByTestId('decide')).toBeVisible(); // now it is his turn, without a reload
    await d.page.getByRole('button', { name: 'Согласовать' }).click();
    await expect(status(d.page)).toHaveText('Согласован');

    // paper: print, sign, scan; then the secretary registers
    await expect(status(s.page)).toHaveText('Согласован');
    await expect(s.page.getByText('Распечатайте PDF, подпишите, отсканируйте и загрузите скан.')).toBeVisible();
    await s.page.getByLabel('Загрузить скан (PDF или фото)').setInputFiles({ name: 'приказ-подписанный.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(status(s.page)).toHaveText('Подписан');
    await expect(s.page.getByRole('button', { name: /Скачать скан: приказ-подписанный.pdf/ })).toBeVisible();
    await s.page.getByLabel('Заменить скан').setInputFiles({ name: 'не-скан.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ') });
    await expect(s.page.locator('p[role="alert"]')).toHaveText('Нужен PDF или фото (PNG, JPEG).');
    s.page.once('dialog', (dlg) => dlg.accept());
    await s.page.getByRole('button', { name: 'Зарегистрировать' }).click();
    await expect(status(s.page)).toHaveText('Зарегистрирован');
    await expect(s.page.getByTestId('document-number')).toHaveText(/^\d+-ПР\/\d{4}$/);

    // the sheet tells the whole story, in order
    const lines = await s.page.getByTestId('sheet-line').allInnerTexts();
    const kinds = ['Отправлен на согласование', 'Возвращено с замечаниями', 'Отправлен на согласование', 'Согласовано', 'Согласовано', 'Согласовано', 'Загружен скан', 'Зарегистрирован'];
    expect(lines).toHaveLength(kinds.length);
    kinds.forEach((k, i) => expect(lines[i]).toContain(k));
    expect(lines[1]).toContain('Не указано основание');
    for (const c of [s, l, a, d]) await c.ctx.close();
  });

  test('two orders registered one after the other get consecutive numbers; the second press does nothing', async ({ browser, request }, info) => {
    const sec = await createEmployee(request, 'sec', info, ['SECRETARY']);
    const law = await createEmployee(request, 'law', info);
    const ts = await token(request, sec);
    const tl = await token(request, law);
    const signedDoc = async (title: string) => {
      const id = await draftOrder(request, sec, title);
      await request.post(`/api/documents/${id}/submit`, { headers: auth(ts), data: { route: [{ approverId: law.id }] } });
      await request.post(`/api/documents/${id}/approve`, { headers: auth(tl), data: {} });
      const up = await request.post(`/api/documents/${id}/scan`, { headers: auth(ts), multipart: { file: { name: 'scan.pdf', mimeType: 'application/pdf', buffer: PDF } } });
      expect(up.ok()).toBe(true);
      return id;
    };
    const first = await signedDoc('Первый приказ');
    const second = await signedDoc('Второй приказ');

    const s = await openAs(browser, sec, info);
    const register = async (id: string) => {
      await s.page.goto(`/documents/${id}`);
      s.page.once('dialog', (dlg) => dlg.accept());
      await s.page.getByRole('button', { name: 'Зарегистрировать' }).click();
      await expect(status(s.page)).toHaveText('Зарегистрирован');
      const text = (await s.page.getByTestId('document-number').innerText()).trim();
      const m = /^(\d+)-ПР\/(\d{4})$/.exec(text);
      expect(m).not.toBeNull();
      return Number(m![1]);
    };
    const n1 = await register(first);
    const n2 = await register(second);
    expect(n2).toBe(n1 + 1);
    // registered: no button any more, and the API refuses a repeat
    await expect(s.page.getByRole('button', { name: 'Зарегистрировать' })).toHaveCount(0);
    expect((await request.post(`/api/documents/${second}/register`, { headers: auth(ts) })).status()).toBe(409);
    await s.ctx.close();
  });
});
