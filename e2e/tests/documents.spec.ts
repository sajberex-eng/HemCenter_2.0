import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { createEmployee, EMPLOYEE_PASSWORD, nav, openAs, type Person } from './helpers';

async function token(request: APIRequestContext, p: Person) {
  return (await (await request.post('/api/auth/login', { data: { login: p.login, password: EMPLOYEE_PASSWORD } })).json()).accessToken as string;
}

test.describe('documents from templates', () => {
  test('an employee writes a memo, downloads it as Word and PDF, edits it; colleagues do not see it', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const a = await openAs(browser, anna, info);
    await nav(a.page).getByRole('link', { name: 'Документы' }).click();
    await expect(a.page.getByText('Документов пока нет.')).toBeVisible();
    await a.page.getByRole('link', { name: 'Новый документ' }).click();

    await a.page.getByLabel('Вид документа').selectOption({ label: 'Служебная записка' });
    await a.page.getByLabel('Заголовок').fill('О закупке канцтоваров');
    await a.page.getByLabel('Кому').fill('Директору центра');
    await a.page.getByLabel('Текст').fill('Прошу согласовать закупку на квартал.');
    await a.page.getByRole('button', { name: 'Добавить поручение' }).click();
    await a.page.getByLabel('Что сделать').fill('Подготовить заявку');
    await a.page.getByLabel('Ответственный', { exact: true }).selectOption({ label: boris.fullName });
    await a.page.getByRole('button', { name: 'Создать' }).click();

    await expect(a.page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
    await expect(a.page.getByTestId('document-status')).toHaveText('Черновик');
    await expect(a.page.getByTestId('document-number')).toHaveText('Номер присваивается при регистрации');
    await expect(a.page.getByText(`Подготовить заявку — ${boris.fullName}`)).toBeVisible();

    const [docx] = await Promise.all([a.page.waitForEvent('download'), a.page.getByRole('button', { name: 'Скачать Word' }).click()]);
    expect(docx.suggestedFilename()).toBe('О закупке канцтоваров.docx');
    expect((await readFile((await docx.path())!)).subarray(0, 2).toString()).toBe('PK');

    const [pdf] = await Promise.all([a.page.waitForEvent('download'), a.page.getByRole('button', { name: 'Скачать PDF' }).click()]);
    expect((await readFile((await pdf.path())!)).subarray(0, 5).toString()).toBe('%PDF-');
    await expect(a.page.getByText(/^[0-9a-f]{64}$/)).toBeVisible(); // the PDF's checksum is shown once it exists

    await a.page.getByRole('button', { name: 'Редактировать' }).click();
    await expect(a.page.getByLabel('Вид документа')).toBeDisabled();
    await a.page.getByLabel('Заголовок').fill('О закупке канцелярии');
    await a.page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(a.page.getByRole('heading', { name: 'О закупке канцелярии' })).toBeVisible();
    await expect(a.page.getByText(/^[0-9a-f]{64}$/)).toHaveCount(0); // the text changed, so the old PDF is gone

    await a.page.goto('/documents');
    await expect(a.page.getByTestId('document-item')).toHaveCount(1);
    await a.ctx.close();

    const b = await openAs(browser, boris, info);
    await b.page.goto('/documents');
    await expect(b.page.getByText('Документов пока нет.')).toBeVisible();
    await b.ctx.close();
  });

  test('the secretary uploads a template version; a file that is not a template is refused with the reason', async ({ browser, request }, info) => {
    const sec = await createEmployee(request, 'sec', info, ['SECRETARY']);
    const anna = await createEmployee(request, 'anna', info);
    const ts = await token(request, sec);
    const auth = { Authorization: `Bearer ${ts}` };

    const a = await openAs(browser, anna, info);
    await a.page.goto('/documents');
    await expect(a.page.getByRole('link', { name: 'Шаблоны' })).toHaveCount(0);
    await a.ctx.close();

    // the built-in order template, taken back as a file, is a valid starting point for the secretary's own
    const kinds = (await (await request.get('/api/document-kinds', { headers: auth })).json()) as { id: string; code: string }[];
    const order = kinds.find((k) => k.code === 'ORDER')!;
    const list = (await (await request.get(`/api/document-templates?kindId=${order.id}`, { headers: auth })).json()) as { id: string; lang: string }[];
    const ruTemplate = Buffer.from(await (await request.get(`/api/document-templates/${list.find((x) => x.lang === 'ru')!.id}/file`, { headers: auth })).body());

    const s = await openAs(browser, sec, info);
    await s.page.goto('/documents');
    await s.page.getByRole('link', { name: 'Шаблоны' }).click();
    const card = s.page.getByTestId('kind-card').filter({ hasText: 'Приказ по основной деятельности' });
    const ru = card.getByTestId('templates-ru');
    await expect(ru.getByRole('listitem').first()).toBeVisible();
    const before = await ru.getByRole('listitem').count(); // earlier runs on a shared database may have added versions
    expect(before).toBeGreaterThan(0);

    await card.getByLabel('Загрузить новую версию: Приказ по основной деятельности (ru)').setInputFiles({ name: 'приказ.docx', mimeType: 'application/octet-stream', buffer: ruTemplate });
    await expect(s.page.getByText('Загружено.', { exact: true })).toBeVisible();
    await expect(ru.getByRole('listitem')).toHaveCount(before + 1);
    await expect(ru.getByRole('listitem').first()).toContainText(`Версия ${before + 1}`);
    await expect(ru.getByRole('listitem').first()).toContainText('действует');

    await card.getByLabel('Загрузить новую версию: Приказ по основной деятельности (ru)').setInputFiles({ name: 'заметки.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('это не Word') });
    await expect(s.page.locator('p[role="alert"]')).toHaveText('Файл не подходит как шаблон.');
    await expect(s.page.getByRole('listitem').filter({ hasText: 'not a Word' })).toBeVisible();
    await expect(ru.getByRole('listitem')).toHaveCount(before + 1); // the refused file left no trace
    await s.ctx.close();
  });
});
