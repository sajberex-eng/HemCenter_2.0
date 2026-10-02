import { expect, test } from '@playwright/test';
import { createEmployee, nav, openAs } from './helpers';

const isoIn = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
const status = (page: import('@playwright/test').Page) => page.getByTestId('assignment-status');

test.describe('execution control (П-3.7.1)', () => {
  test('give → take on → report with a file → returned → due date moved → report → accepted', async ({ browser, request }, info) => {
    const lead = await createEmployee(request, 'lead', info, ['PROJECT_MANAGER']);
    const anna = await createEmployee(request, 'anna', info);
    const l = await openAs(browser, lead, info);
    await nav(l.page).getByRole('link', { name: 'Поручения' }).click();
    await l.page.getByRole('link', { name: 'Новое поручение' }).click();
    await l.page.getByLabel('Что нужно сделать').fill('Подготовить сводный реестр');
    await l.page.getByLabel('Ответственный', { exact: true }).selectOption({ label: anna.fullName });
    await l.page.getByLabel('Срок', { exact: true }).fill(isoIn(7));
    await l.page.getByRole('button', { name: 'Создать' }).click();
    await expect(l.page).toHaveURL(/\/assignments\/[0-9a-f-]{36}$/);
    await expect(status(l.page)).toHaveText('Новое');
    await expect(l.page.getByTestId('overdue')).toHaveCount(0);

    // Anna is told: a badge in the menu, a line in the list that opens the assignment
    const a = await openAs(browser, anna, info);
    await expect(nav(a.page).getByRole('link', { name: /Уведомления/ }).getByLabel('1')).toBeVisible();
    await nav(a.page).getByRole('link', { name: /Уведомления/ }).click();
    const line = a.page.getByTestId('notification').first();
    await expect(line).toContainText('Вам назначено поручение');
    await line.getByRole('link').click();
    await expect(a.page.getByRole('heading', { name: 'Подготовить сводный реестр' })).toBeVisible();
    await a.page.getByRole('button', { name: 'Взять в работу' }).click();
    await expect(status(a.page)).toHaveText('В работе');

    await a.page.getByLabel('Отчёт об исполнении').fill('Реестр подготовлен, файл приложен');
    await a.page.getByLabel('Файлы (до 5)').setInputFiles({ name: 'реестр.txt', mimeType: 'text/plain', buffer: Buffer.from('строки реестра') });
    await a.page.getByRole('button', { name: 'Отправить отчёт' }).click();
    await expect(status(a.page)).toHaveText('На проверке');
    await expect(a.page.getByTestId('report').first()).toContainText('реестр.txt');

    // the controller's open page followed along; the file opens; returning needs a reason
    await l.page.reload();
    await expect(status(l.page)).toHaveText('На проверке');
    const [download] = await Promise.all([l.page.waitForEvent('download'), l.page.getByRole('button', { name: /реестр\.txt/ }).click()]);
    expect(download.suggestedFilename()).toBe('реестр.txt');
    await l.page.getByRole('button', { name: 'Вернуть на доработку' }).click();
    await expect(l.page.locator('p[role="alert"]')).toHaveText('Для возражения нужен комментарий.');
    await l.page.getByLabel('Комментарий').fill('Добавьте поставщиков из второго списка');
    await l.page.getByRole('button', { name: 'Вернуть на доработку' }).click();
    await expect(status(l.page)).toHaveText('Возвращено на доработку');

    // Anna asks for more time; the controller agrees
    await a.page.reload();
    await expect(status(a.page)).toHaveText('Возвращено на доработку');
    await expect(a.page.getByTestId('report').first()).toContainText('Добавьте поставщиков из второго списка');
    await a.page.getByLabel('Новый срок').fill(isoIn(14));
    await a.page.getByLabel('Основание', { exact: true }).fill('Ждём данные от бухгалтерии');
    await a.page.getByRole('button', { name: 'Перенести срок' }).click();
    await expect(a.page.getByTestId('due-change')).toContainText('Ждёт решения контролёра');
    await l.page.reload();
    await l.page.getByLabel('Комментарий').fill('Согласовано');
    await l.page.getByRole('button', { name: 'Согласовать' }).click();
    await expect(l.page.getByTestId('due-change')).toContainText('Согласован');

    // the second report is accepted
    await a.page.reload();
    await a.page.getByLabel('Отчёт об исполнении').fill('Добавлены поставщики');
    await a.page.getByRole('button', { name: 'Отправить отчёт' }).click();
    await expect(status(a.page)).toHaveText('На проверке');
    await l.page.reload();
    await l.page.getByRole('button', { name: 'Принять' }).click();
    await expect(status(l.page)).toHaveText('Исполнено');
    const story = await l.page.getByTestId('event').allInnerTexts();
    expect(story.map((x) => x.replace(/^.*?: /, '').replace(/ — .*$/, ''))).toEqual(['Создано', 'Взято в работу', 'Отправлен отчёт', 'Отчёт возвращён', 'Запрошен перенос срока', 'Перенос срока согласован', 'Отправлен отчёт', 'Отчёт принят']);
    await l.ctx.close();
    await a.ctx.close();
  });

  test('an assignment given from a chat message; an ordinary employee has no such menu item', async ({ browser, request }, info) => {
    const lead = await createEmployee(request, 'lead', info, ['PROJECT_MANAGER']);
    const anna = await createEmployee(request, 'anna', info);
    const l = await openAs(browser, lead, info);
    await l.page.goto('/chats/new');
    await l.page.getByRole('searchbox', { name: 'Найти коллегу' }).fill(anna.fullName);
    await l.page.getByRole('button', { name: anna.fullName, exact: true }).click();
    await l.page.getByRole('textbox', { name: 'Сообщение' }).fill('Анна, нужен отчёт по закупкам');
    await l.page.getByRole('button', { name: 'Отправить' }).click();
    const msg = l.page.getByTestId('message').filter({ hasText: 'нужен отчёт по закупкам' });
    await msg.getByRole('button', { name: 'Действия' }).click();
    await msg.getByRole('button', { name: 'Дать поручение' }).click();
    const dialog = l.page.getByRole('dialog', { name: 'Дать поручение' });
    await expect(dialog.getByRole('button', { name: 'Создать' })).toBeDisabled();
    await dialog.getByLabel('Ответственный', { exact: true }).selectOption({ label: anna.fullName });
    await dialog.getByLabel('Срок', { exact: true }).fill(isoIn(5));
    await dialog.getByRole('button', { name: 'Создать' }).click();
    await expect(dialog).toHaveCount(0);

    const a = await openAs(browser, anna, info);
    await nav(a.page).getByRole('link', { name: 'Поручения' }).click();
    await expect(a.page.getByTestId('assignment-item')).toHaveCount(1);
    await expect(a.page.getByRole('link', { name: 'Новое поручение' })).toHaveCount(0);
    // Anna cannot give assignments from the chat either
    await a.page.goto(`/chats`);
    await a.page.getByTestId('chat-item').first().click();
    const m2 = a.page.getByTestId('message').filter({ hasText: 'нужен отчёт по закупкам' });
    await m2.getByRole('button', { name: 'Действия' }).click();
    await expect(m2.getByRole('button', { name: 'Дать поручение' })).toHaveCount(0);
    await a.ctx.close();
    await l.ctx.close();
  });

  test('management has the overview of what is late; an employee does not', async ({ browser, request }, info) => {
    const boss = await createEmployee(request, 'boss', info, ['MANAGEMENT']);
    const anna = await createEmployee(request, 'anna', info);
    // management must have 2FA when it is required; the test servers run without
    const b = await openAs(browser, boss, info);
    await b.page.goto('/assignments');
    await b.page.getByRole('button', { name: 'Сводка просрочек' }).click();
    await expect(b.page.getByTestId('summary')).toBeVisible();
    await expect(b.page.getByRole('button', { name: 'Все', exact: true })).toBeVisible();
    await b.ctx.close();
    const a = await openAs(browser, anna, info);
    await a.page.goto('/assignments');
    await expect(a.page.getByRole('button', { name: 'Сводка просрочек' })).toHaveCount(0);
    await a.ctx.close();
  });
});
