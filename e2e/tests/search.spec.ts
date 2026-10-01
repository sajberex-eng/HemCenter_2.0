import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createEmployee, EMPLOYEE_PASSWORD, openAs, type Person } from './helpers';

const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Поиск по чатам и сообщениям' });
const hits = (page: Page) => page.getByTestId('search-hit');
const bubble = (page: Page, text: string) => page.getByTestId('message').filter({ hasText: text });

async function token(request: APIRequestContext, p: Person) {
  return (await (await request.post('/api/auth/login', { data: { login: p.login, password: EMPLOYEE_PASSWORD } })).json()).accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** A direct chat with `count` messages from the first person; message `needleAt` contains the needle. */
async function history(request: APIRequestContext, a: Person, b: Person, count: number, needleAt: number, needle: string) {
  const ta = await token(request, a);
  const chat = await (await request.post('/api/chats/direct', { headers: auth(ta), data: { userId: b.id } })).json();
  for (let i = 1; i <= count; i++) {
    await request.post(`/api/chats/${chat.id}/messages`, { headers: auth(ta), data: { body: i === needleAt ? needle : `рабочее сообщение номер ${i}` } });
  }
  return { id: chat.id as string, ta };
}

test.describe('search', () => {
  test('finds a message deep in the history, opens the conversation on it, and leads back to the latest', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const chat = await history(request, anna, boris, 130, 20, 'Приказ №42 о командировке утверждён');
    const b = await openAs(browser, boris, info);
    await b.page.goto('/chats');

    await searchBox(b.page).fill('приказ');
    await expect(hits(b.page)).toHaveCount(1);
    await expect(hits(b.page).locator('mark')).toHaveText('Приказ'); // matched regardless of case, and highlighted
    await hits(b.page).click();

    // the conversation opens on the hit (message 20 of 130), not at the end
    await expect(b.page).toHaveURL(new RegExp(`/chats/${chat.id}\\?m=20$`));
    const target = bubble(b.page, 'Приказ №42');
    await expect(target).toBeVisible();
    await expect(target.locator('div.ring-2')).toBeVisible(); // briefly emphasised
    await expect(bubble(b.page, 'рабочее сообщение номер 130')).toHaveCount(0); // the end is not loaded
    await expect(b.page.getByRole('button', { name: 'Показать более поздние' })).toBeVisible();

    // read further down step by step, then jump to the end
    await b.page.getByRole('button', { name: 'Показать более поздние' }).click();
    await expect(bubble(b.page, 'рабочее сообщение номер 70')).toHaveCount(1);
    await b.page.getByRole('button', { name: 'К последним сообщениям' }).click();
    await expect(bubble(b.page, 'рабочее сообщение номер 130')).toBeVisible();
    await expect(b.page.getByRole('button', { name: 'К последним сообщениям' })).toHaveCount(0);
    await b.ctx.close();
  });

  test('other people\'s conversations are never found; short queries are explained', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const carl = await createEmployee(request, 'carl', info);
    await history(request, anna, boris, 3, 2, 'секретная премия руководству');
    const c = await openAs(browser, carl, info);
    await c.page.goto('/chats');

    await searchBox(c.page).fill('премия');
    await expect(c.page.getByText('Ничего не найдено')).toBeVisible();
    await expect(hits(c.page)).toHaveCount(0);

    await searchBox(c.page).fill('п');
    await expect(c.page.getByText('Введите не меньше двух символов')).toBeVisible();
    await c.ctx.close();
  });

  test('typing a colleague\'s name narrows the chat list; a file name is searchable', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const carl = await createEmployee(request, 'carl', info);
    const ta = await token(request, anna);
    for (const other of [boris, carl]) {
      const chat = await (await request.post('/api/chats/direct', { headers: auth(ta), data: { userId: other.id } })).json();
      if (other === boris) {
        const up = await request.post(`/api/chats/${chat.id}/attachments`, { headers: auth(ta), multipart: { file: { name: 'Реестр-поставщиков-2026.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('rows') } } });
        await request.post(`/api/chats/${chat.id}/messages`, { headers: auth(ta), data: { attachmentIds: [(await up.json()).id] } });
      } else {
        await request.post(`/api/chats/${chat.id}/messages`, { headers: auth(ta), data: { body: 'привет' } });
      }
    }
    const a = await openAs(browser, anna, info);
    await a.page.goto('/chats');
    await expect(a.page.getByTestId('chat-item')).toHaveCount(2);

    await searchBox(a.page).fill(carl.fullName);
    await expect(a.page.getByTestId('chat-item')).toHaveCount(1);
    await expect(a.page.getByTestId('chat-item')).toContainText(carl.fullName);

    await searchBox(a.page).fill('реестр-пост');
    await expect(hits(a.page)).toHaveCount(1);
    await expect(hits(a.page)).toContainText('📎');
    await a.ctx.close();
  });
});

test.describe('pinned messages', () => {
  test('pinning shows a bar for both people in real time; either may unpin; tapping jumps to the message', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const chat = await history(request, anna, boris, 80, 3, 'Важно: сдача отчёта до пятницы');
    const a = await openAs(browser, anna, info);
    const b = await openAs(browser, boris, info);
    await a.page.goto(`/chats/${chat.id}`);
    await b.page.goto(`/chats/${chat.id}`);
    await expect(b.page.locator('html')).toHaveAttribute('data-live', '1');

    // Anna opens the older message (through search) and pins it
    await a.page.goto(`/chats/${chat.id}?m=3`);
    await bubble(a.page, 'Важно: сдача отчёта').getByRole('button', { name: 'Действия' }).click();
    await a.page.getByRole('button', { name: 'Закрепить' }).click();
    await expect(a.page.getByTestId('pin-bar')).toContainText('Важно: сдача отчёта до пятницы');
    await expect(b.page.getByTestId('pin-bar')).toContainText('Важно: сдача отчёта до пятницы'); // arrived live

    // Boris is at the end of the history; tapping the bar takes him to the message
    await expect(bubble(b.page, 'Важно: сдача отчёта')).toHaveCount(0);
    await b.page.getByTestId('pin-bar').click();
    await expect(b.page).toHaveURL(new RegExp(`\\?m=3$`));
    await expect(bubble(b.page, 'Важно: сдача отчёта')).toBeVisible();

    // in a direct chat either person can unpin
    await bubble(b.page, 'Важно: сдача отчёта').getByRole('button', { name: 'Действия' }).click();
    await b.page.getByRole('button', { name: 'Открепить' }).click();
    await expect(b.page.getByTestId('pin-bar')).toHaveCount(0);
    await expect(a.page.getByTestId('pin-bar')).toHaveCount(0);
    await a.ctx.close();
    await b.ctx.close();
  });

  test('in a group only the owner sees the pin action', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const ta = await token(request, anna);
    const g = await (await request.post('/api/chats/groups', { headers: auth(ta), data: { title: 'Команда', memberIds: [boris.id] } })).json();
    await request.post(`/api/chats/${g.id}/messages`, { headers: auth(ta), data: { body: 'правила группы' } });

    const a = await openAs(browser, anna, info);
    const b = await openAs(browser, boris, info);
    await a.page.goto(`/chats/${g.id}`);
    await b.page.goto(`/chats/${g.id}`);
    await bubble(a.page, 'правила группы').getByRole('button', { name: 'Действия' }).click();
    await expect(a.page.getByRole('button', { name: 'Закрепить' })).toBeVisible();
    await bubble(b.page, 'правила группы').getByRole('button', { name: 'Действия' }).click();
    await expect(b.page.getByRole('button', { name: 'Ответить' })).toBeVisible();
    await expect(b.page.getByRole('button', { name: 'Закрепить' })).toHaveCount(0);
    await a.ctx.close();
    await b.ctx.close();
  });
});
