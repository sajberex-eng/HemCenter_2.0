import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createEmployee, nav, openAs } from './helpers';

const isPhone = (name: string) => name === 'phone';

/** Starts a direct chat from the "new chat" screen. */
async function startDirect(page: Page, fullName: string) {
  await page.goto('/chats/new');
  await page.getByRole('searchbox', { name: 'Найти коллегу' }).fill(fullName);
  await page.getByRole('button', { name: fullName }).click();
  await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Сообщение' });
const sendButton = (page: Page) => page.getByRole('button', { name: 'Отправить' });
/** All messages containing the text. A quote inside a reply repeats the original text, so use .first() for the original. */
const bubble = (page: Page, text: string) => page.getByTestId('message').filter({ hasText: text });

async function say(page: Page, text: string) {
  await composer(page).fill(text);
  await sendButton(page).click();
  await expect(bubble(page, text)).toBeVisible();
}

test.describe('direct chat', () => {
  test('live delivery, unread badge, read receipt, reply, edit and delete', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const a = await openAs(browser, anna, info);
    const b = await openAs(browser, boris, info);

    // Boris is on another screen when Anna writes: the badge appears without any reload
    await b.page.goto('/staff');
    await startDirect(a.page, boris.fullName);
    await say(a.page, 'Добрый день! Прошу подтвердить получение.');
    await expect(nav(b.page).getByLabel('1')).toBeVisible();

    // Boris sees the chat with an unread counter and opens it
    await b.page.goto('/chats');
    const item = b.page.getByTestId('chat-item').filter({ hasText: anna.fullName });
    await expect(item.getByLabel('1')).toBeVisible();
    await item.click();
    await expect(bubble(b.page, 'Добрый день!')).toBeVisible();
    // on a phone the list is replaced by the conversation, on a desktop both are visible
    if (isPhone(info.project.name)) await expect(item).toBeHidden();
    else await expect(item).toBeVisible();

    // Anna's message gets the double tick once Boris has it open
    await expect(bubble(a.page, 'Добрый день!').getByLabel('Прочитано')).toBeVisible();

    // Boris replies to Anna's message
    await bubble(b.page, 'Добрый день!').getByRole('button', { name: 'Действия' }).click();
    await b.page.getByRole('button', { name: 'Ответить' }).click();
    await expect(b.page.getByText(`Ответ для ${anna.fullName}`)).toBeVisible();
    await say(b.page, 'Получил, спасибо.');
    const quoted = bubble(a.page, 'Получил, спасибо.');
    await expect(quoted).toBeVisible();
    await expect(quoted.getByText('Добрый день! Прошу подтвердить получение.')).toBeVisible();

    // Anna edits her message; Boris sees it change with a mark
    await bubble(a.page, 'Добрый день!').first().getByRole('button', { name: 'Действия' }).click();
    await a.page.getByRole('button', { name: 'Изменить' }).click();
    await composer(a.page).fill('Добрый день! Прошу подтвердить получение до 17:00.');
    await sendButton(a.page).click();
    const edited = bubble(b.page, 'до 17:00').first(); // the original; Boris's reply quotes it too
    await expect(edited).toBeVisible();
    await expect(edited.getByText('изменено')).toBeVisible();
    // the quote inside Boris's own reply follows the edit
    await expect(bubble(b.page, 'Получил, спасибо.').getByText('до 17:00')).toBeVisible();

    // Anna deletes it; Boris sees the placeholder and the text is gone from his page
    a.page.once('dialog', (d) => d.accept());
    await bubble(a.page, 'до 17:00').first().getByRole('button', { name: 'Действия' }).click();
    await a.page.getByRole('button', { name: 'Удалить' }).click();
    await expect(b.page.getByText('Сообщение удалено').first()).toBeVisible();
    // neither the message nor its quote inside Boris's own reply may keep showing the deleted text
    await expect(b.page.getByText('Прошу подтвердить получение')).toHaveCount(0);

    await a.ctx.close();
    await b.ctx.close();
  });

  test('message text is never interpreted as markup or as a javascript link', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const a = await openAs(browser, anna, info);
    const b = await openAs(browser, boris, info);
    await startDirect(a.page, boris.fullName);

    let dialogs = 0;
    for (const p of [a.page, b.page]) p.on('dialog', (d) => { dialogs++; void d.dismiss(); });
    await say(a.page, '<img src=x onerror=alert(1)> <script>alert(2)</script>');
    await say(a.page, 'javascript:alert(3)');
    await say(a.page, 'Регламент: https://example.kz/reglament.pdf, пожалуйста.');

    await b.page.goto('/chats');
    await b.page.getByTestId('chat-item').first().click();
    await expect(bubble(b.page, '<script>alert(2)</script>')).toBeVisible(); // shown literally
    await expect(b.page.locator('img[src="x"]')).toHaveCount(0);
    await expect(b.page.locator('a[href^="javascript"]')).toHaveCount(0);
    // inside the conversation only: the chat list preview shows the same text
    const link = b.page.getByTestId('messages').getByRole('link', { name: 'https://example.kz/reglament.pdf' });
    await expect(link).toHaveAttribute('href', 'https://example.kz/reglament.pdf');
    await expect(link).toHaveAttribute('rel', /noopener/);
    expect(dialogs).toBe(0);

    await a.ctx.close();
    await b.ctx.close();
  });
});

test.describe('group chat', () => {
  test('mentions, owner-only controls, removal cuts access', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const carl = await createEmployee(request, 'carl', info);
    const a = await openAs(browser, anna, info);
    const b = await openAs(browser, boris, info);
    const c = await openAs(browser, carl, info);

    // Anna creates the group
    await a.page.goto('/chats/new');
    await a.page.getByRole('tab', { name: 'Группа' }).click();
    await a.page.getByLabel('Название группы').fill('Бухгалтерия');
    await a.page.getByRole('searchbox', { name: 'Найти коллегу' }).fill(boris.fullName);
    await a.page.getByLabel(boris.fullName).check();
    await a.page.getByRole('searchbox', { name: 'Найти коллегу' }).fill(carl.fullName);
    await a.page.getByLabel(carl.fullName).check();
    await expect(a.page.getByText('Выбрано: 2')).toBeVisible();
    await a.page.getByRole('button', { name: 'Создать группу' }).click();
    await expect(a.page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);

    // a mention through the suggestion list
    await composer(a.page).fill('Коллеги, @');
    await composer(a.page).pressSequentially(boris.fullName.slice(0, 8));
    await a.page.getByRole('option', { name: boris.fullName }).click();
    await composer(a.page).pressSequentially('проверьте реестр');
    await sendButton(a.page).click();
    await expect(bubble(a.page, 'проверьте реестр')).toBeVisible();

    // Boris and Carl have the group; the mention is highlighted for Boris
    await b.page.goto('/chats');
    await b.page.getByTestId('chat-item').filter({ hasText: 'Бухгалтерия' }).click();
    await expect(bubble(b.page, 'проверьте реестр').locator('span', { hasText: `@${boris.fullName}` })).toBeVisible();
    await c.page.goto('/chats');
    await expect(c.page.getByTestId('chat-item').filter({ hasText: 'Бухгалтерия' })).toBeVisible();

    // Boris is only a member: no rename field, no remove buttons
    await b.page.getByRole('button', { name: 'О чате' }).first().click();
    const dialog = b.page.getByRole('dialog');
    await expect(dialog.getByText('Участников: 3')).toBeVisible();
    await expect(dialog.getByLabel('Переименовать')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Удалить' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Закрыть' }).click();

    // Anna (owner) removes Carl: his list loses the chat in real time
    await a.page.getByRole('button', { name: 'О чате' }).first().click();
    const ownerDialog = a.page.getByRole('dialog');
    await expect(ownerDialog.getByLabel('Переименовать')).toBeVisible();
    a.page.once('dialog', (d) => d.accept());
    await ownerDialog.getByRole('listitem').filter({ hasText: carl.fullName }).getByRole('button', { name: 'Удалить' }).click();
    await expect(c.page.getByTestId('chat-item').filter({ hasText: 'Бухгалтерия' })).toHaveCount(0);
    await expect(ownerDialog.getByText('Участников: 2')).toBeVisible();

    await a.ctx.close();
    await b.ctx.close();
    await c.ctx.close();
  });
});

test.describe('phone layout', () => {
  test('an open conversation fills the screen and the back arrow returns to the list', async ({ browser, request }, info) => {
    test.skip(!isPhone(info.project.name), 'phone only');
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const a = await openAs(browser, anna, info);
    await startDirect(a.page, boris.fullName);

    await expect(composer(a.page)).toBeVisible();
    await expect(a.page.locator('nav:visible')).toHaveCount(0); // bottom bar hidden inside a conversation
    const overflow = await a.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // the message box stays inside the screen
    const box = await composer(a.page).boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(667);

    await a.page.getByRole('link', { name: 'Назад' }).click();
    await expect(a.page).toHaveURL(/\/chats$/);
    await expect(a.page.locator('nav:visible')).toHaveCount(1);
    await a.ctx.close();
  });
});

// 1x1 transparent PNG
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.describe('attachments', () => {
  test('sending a file and an image; the recipient downloads the exact bytes', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const a = await openAs(browser, anna, info);
    const b = await openAs(browser, boris, info);
    await startDirect(a.page, boris.fullName);

    const content = Buffer.from('Протокол №1\nРешили: утвердить план.\n');
    await a.page.getByTestId('file-input').setInputFiles([
      { name: 'Протокол №1.txt', mimeType: 'text/plain', buffer: content },
      { name: 'scan.png', mimeType: 'image/png', buffer: PNG_1PX },
    ]);
    const chips = a.page.getByTestId('pending-file');
    await expect(chips).toHaveCount(2);
    await expect(chips.filter({ hasText: 'Загрузка…' })).toHaveCount(0); // both finished uploading
    await composer(a.page).fill('Во вложении протокол и скан');
    await sendButton(a.page).click();
    await expect(chips).toHaveCount(0);
    await expect(a.page.getByTestId('attachment-file')).toBeVisible();

    // Boris sees both; the image really renders (loaded through an authorised request)
    await b.page.goto('/chats');
    await b.page.getByTestId('chat-item').filter({ hasText: anna.fullName }).click();
    const card = b.page.getByTestId('attachment-file');
    await expect(card).toContainText('Протокол №1.txt');
    const img = b.page.getByTestId('attachment-image');
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

    const [download] = await Promise.all([b.page.waitForEvent('download'), card.click()]);
    expect(download.suggestedFilename()).toBe('Протокол №1.txt');
    const saved = await readFile((await download.path())!);
    expect(saved.equals(content)).toBe(true);

    await a.ctx.close();
    await b.ctx.close();
  });

  test('a file alone is a message; programs are refused; an unsent file can be taken back', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const a = await openAs(browser, anna, info);
    await startDirect(a.page, boris.fullName);

    // a program is rejected with a clear reason and cannot be sent
    await a.page.getByTestId('file-input').setInputFiles({ name: 'setup.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ....') });
    const bad = a.page.getByTestId('pending-file');
    await expect(bad).toContainText('Этот тип файла нельзя отправлять');
    await expect(sendButton(a.page)).toBeDisabled();
    await bad.getByRole('button', { name: /Убрать файл/ }).click();
    await expect(bad).toHaveCount(0);

    // an uploaded file that is removed before sending never becomes a message
    await a.page.getByTestId('file-input').setInputFiles({ name: 'draft.txt', mimeType: 'text/plain', buffer: Buffer.from('draft') });
    await expect(a.page.getByTestId('pending-file')).toContainText('draft.txt');
    await expect(a.page.getByTestId('pending-file')).not.toContainText('Загрузка…');
    await a.page.getByTestId('pending-file').getByRole('button', { name: /Убрать файл/ }).click();
    await expect(sendButton(a.page)).toBeDisabled();
    await expect(a.page.getByTestId('message')).toHaveCount(0);

    // a file without any text is accepted as a message and shown in the chat list preview
    await a.page.getByTestId('file-input').setInputFiles({ name: 'Реестр.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('rows') });
    await expect(a.page.getByTestId('pending-file')).not.toContainText('Загрузка…');
    await sendButton(a.page).click();
    await expect(a.page.getByTestId('attachment-file')).toContainText('Реестр.xlsx');
    if (!isPhone(info.project.name)) await expect(a.page.getByTestId('chat-item').first()).toContainText('📎 Реестр.xlsx');
    await a.ctx.close();
  });

  test('a screenshot pasted from the clipboard becomes an attachment', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const a = await openAs(browser, anna, info);
    await startDirect(a.page, boris.fullName);

    await composer(a.page).evaluate((el, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, PNG_1PX.toString('base64'));
    await expect(a.page.getByTestId('pending-file')).toContainText('image.png');
    await expect(composer(a.page)).toHaveValue(''); // nothing was pasted as text
    await a.ctx.close();
  });
});
