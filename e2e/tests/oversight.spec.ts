import { expect, test, type APIRequestContext } from '@playwright/test';
import { createEmployee, EMPLOYEE_PASSWORD, nav, openAs, type Person } from './helpers';

async function token(request: APIRequestContext, p: Person) {
  return (await (await request.post('/api/auth/login', { data: { login: p.login, password: EMPLOYEE_PASSWORD } })).json()).accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

test.describe('management view', () => {
  test('management reads a chat it is not in; the members are told how often it was opened', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const director = await createEmployee(request, 'director', info, ['MANAGEMENT']);
    const ta = await token(request, anna);
    const chat = await (await request.post('/api/chats/direct', { headers: auth(ta), data: { userId: boris.id } })).json();
    await request.post(`/api/chats/${chat.id}/messages`, { headers: auth(ta), data: { body: 'Смета на ремонт согласована' } });

    const d = await openAs(browser, director, info);
    // the ordinary chat list does not contain it: management is a stranger there
    await d.page.goto('/chats');
    await expect(d.page.getByTestId('chat-item')).toHaveCount(0);

    await nav(d.page).getByRole('link', { name: 'Просмотр как руководство' }).click();
    await expect(d.page.getByTestId('oversight-banner')).toContainText('Каждый просмотр записывается в журнал аудита');
    await d.page.getByRole('searchbox', { name: 'Найти чат или сотрудника' }).fill(anna.fullName);
    const item = d.page.getByTestId('oversight-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(boris.fullName);
    await item.click();

    await expect(d.page.getByTestId('message').filter({ hasText: 'Смета на ремонт согласована' })).toBeVisible();
    await expect(d.page.getByText('Только чтение')).toBeVisible();
    await expect(d.page.getByRole('textbox', { name: 'Сообщение' })).toHaveCount(0);
    await expect(d.page.getByRole('button', { name: 'Действия' })).toHaveCount(0);
    await d.ctx.close();

    // Boris sees that management looked, but not who
    const b = await openAs(browser, boris, info);
    await b.page.goto(`/chats/${chat.id}`);
    await b.page.getByRole('button', { name: 'О чате' }).click();
    const note = b.page.getByTestId('oversight-note');
    await expect(note).toContainText('Руководство центра вправе просматривать переписку');
    await expect(note).toContainText('Руководство открывало этот чат: 1.');
    await expect(note).not.toContainText(director.fullName);
    await b.ctx.close();
  });

  test('an ordinary employee has no such menu item and is sent away from the address', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const a = await openAs(browser, anna, info);
    await expect(nav(a.page).getByRole('link', { name: 'Просмотр как руководство' })).toHaveCount(0);
    await a.page.goto('/oversight');
    await expect(a.page).toHaveURL(/\/$/);
    await a.ctx.close();
  });
});
