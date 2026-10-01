import { expect, test, type Page } from '@playwright/test';
import { ADMIN, createEmployee, openAs, signIn, type Person } from './helpers';

const exportFor = (anna: Person, boris: Person) =>
  [
    '22.03.2024, 14:30 - Сообщения и звонки защищены сквозным шифрованием.',
    `22.03.2024, 14:36 - ${anna.fullName}: Добрый день! Реестр поставщиков готов.`,
    'Прошу проверить до пятницы.',
    `22.03.2024, 14:40 - ${boris.fullName}: Принял, посмотрю`,
    '23.03.2024, 18:00 - Гость Из Города: Передайте всем привет',
  ].join('\n');

async function asAdmin(page: Page) {
  await signIn(page, ADMIN.login, ADMIN.password);
  await page.goto('/admin/import');
}

const upload = (page: Page, name: string, text: string) =>
  page.getByTestId('import-file').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

test.describe('import from WhatsApp', () => {
  test('upload, check the proposals, import; members read the read-only archive, the administrator cannot', async ({ browser, request, page }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    await asAdmin(page);

    await upload(page, 'Чат WhatsApp с Бухгалтерия.txt', exportFor(anna, boris));
    await expect(page.getByTestId('import-count')).toHaveText('3');
    await expect(page.getByLabel('Название архива')).toHaveValue('Бухгалтерия');

    // the two colleagues were recognised by name; the guest stays outside
    // the select lists every employee, so rows cannot be told apart by text: use the accessible name
    const rowOf = (name: string) => page.getByLabel(name, { exact: true });
    await expect(rowOf(anna.fullName)).toHaveValue(/[0-9a-f-]{36}/);
    await expect(rowOf(boris.fullName)).toHaveValue(/[0-9a-f-]{36}/);
    await expect(rowOf('Гость Из Города')).toHaveValue('');
    await expect(page.getByTestId('import-members')).toHaveText('Увидят архив: 2');

    page.once('dialog', (d) => {
      expect(d.message()).toContain('Бухгалтерия');
      return d.accept();
    });
    await page.getByRole('button', { name: 'Импортировать' }).click();
    await expect(page.getByTestId('import-done')).toContainText('Перенесено сообщений: 3');
    await expect(page.getByTestId('import-done')).toContainText('внешних участников: 1');

    // Anna finds the archive in her chats, marked as an archive, and can only read it
    const a = await openAs(browser, anna, info);
    await a.page.goto('/chats');
    const item = a.page.getByTestId('chat-item').filter({ hasText: 'Бухгалтерия' });
    await expect(item).toContainText('Архив');
    await expect(item.getByLabel(/^\d+$/)).toHaveCount(0); // history is not "unread"
    await item.click();
    await expect(a.page.getByTestId('message').filter({ hasText: 'Реестр поставщиков готов' })).toBeVisible();
    await expect(a.page.getByTestId('message').filter({ hasText: 'Гость Из Города' })).toBeVisible(); // outside name shown as author
    await expect(a.page.getByTestId('archive-note')).toHaveText('Архив переписки: только чтение');
    await expect(a.page.getByRole('textbox', { name: 'Сообщение' })).toHaveCount(0);
    await expect(a.page.getByRole('button', { name: 'Действия' })).toHaveCount(0);

    // and it is searchable
    await a.page.goto('/chats');
    await a.page.getByRole('searchbox', { name: 'Поиск по чатам и сообщениям' }).fill('реестр');
    await expect(a.page.getByTestId('search-hit')).toHaveCount(1);
    await a.ctx.close();

    // the administrator who imported it has no access to the content
    await page.goto('/chats');
    await expect(page.getByTestId('chat-item').filter({ hasText: 'Бухгалтерия' })).toHaveCount(0);
  });

  test('an unclear date order is flagged and can be switched; nothing can be imported without a member', async ({ request, page }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    await asAdmin(page);
    await upload(page, 'x.txt', `03.04.2024, 10:00 - ${anna.fullName}: первое\n04.04.2024, 11:00 - ${anna.fullName}: второе`);
    await expect(page.getByTestId('import-count')).toHaveText('2');
    await expect(page.getByTestId('date-order').getByRole('note')).toContainText('нет даты, по которой можно понять порядок');

    await page.getByTestId('date-order').getByText('Образцы сообщений').click();
    const sample = page.getByTestId('date-order').locator('li').first();
    await expect(sample).toContainText('03.04.2024'); // day first: 3 April

    await page.getByLabel('Порядок даты').selectOption('MDY');
    await page.getByRole('button', { name: 'Пересчитать' }).click();
    await expect(page.getByTestId('date-order').locator('li').first()).toContainText('04.03.2024'); // month first: 4 March

    // everything set to "outside": no one could read the archive, so the button stays off
    const combo = page.getByTestId('author-row').getByRole('combobox');
    await combo.selectOption('');
    await expect(page.getByRole('button', { name: 'Импортировать' })).toBeDisabled();
    await expect(page.getByText('Сопоставьте хотя бы одного сотрудника')).toBeVisible();

    await page.getByRole('button', { name: 'Отменить загрузку' }).click();
    await expect(page.getByRole('button', { name: 'Выбрать файл экспорта' })).toBeVisible();
  });

  test('a file that is not an export is refused with a clear message', async ({ page }) => {
    await asAdmin(page);
    await upload(page, 'notes.txt', 'это просто заметки без дат и авторов');
    await expect(page.locator('p[role="alert"]')).toHaveText('В файле не найдено ни одного сообщения.');
    await expect(page.getByRole('button', { name: 'Выбрать файл экспорта' })).toBeVisible();
    await page.getByTestId('import-file').setInputFiles({ name: 'program.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
    await expect(page.locator('p[role="alert"]')).toContainText('Нужен файл экспорта WhatsApp');
  });
});
