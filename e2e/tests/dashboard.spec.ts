import { expect, test, type APIRequestContext } from '@playwright/test';
import { createEmployee, EMPLOYEE_PASSWORD, nav, openAs, type Person } from './helpers';

async function token(request: APIRequestContext, p: Person) {
  return (await (await request.post('/api/auth/login', { data: { login: p.login, password: EMPLOYEE_PASSWORD } })).json()).accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const isoIn = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);

test.describe('the head\'s dashboard (TZ 3.10)', () => {
  test('shows late milestones, overload and unanswered decisions; employees do not get it', async ({ browser, request }, info) => {
    const boss = await createEmployee(request, 'boss', info, ['MANAGEMENT']);
    const lead = await createEmployee(request, 'lead', info, ['PROJECT_MANAGER']);
    const anna = await createEmployee(request, 'anna', info);
    const tl = await token(request, lead);
    const name = `Реестр ${Date.now()}`;
    const shares = [50, 40, 30];
    let first = '';
    for (const [i, share] of shares.entries()) {
      const p = await (await request.post('/api/projects', { headers: auth(tl), data: { name: i === 0 ? name : `${name} ${i}`, members: [{ userId: anna.id, allocation: share }] } })).json();
      if (i === 0) first = p.id;
    }
    await request.patch(`/api/projects/${first}`, { headers: auth(tl), data: { status: 'ACTIVE' } });
    await request.post(`/api/projects/${first}/milestones`, { headers: auth(tl), data: { title: 'Сбор данных', dueDate: isoIn(-5) } });
    const chat = await (await request.post('/api/chats/direct', { headers: auth(tl), data: { userId: anna.id } })).json();
    const msg = await (await request.post(`/api/chats/${chat.id}/messages`, { headers: auth(tl), data: { body: 'Переходим на новый формат' } })).json();
    await request.post(`/api/chats/${chat.id}/messages/${msg.id}/decision`, { headers: auth(tl), data: { text: `Решение ${name}`, addresseeIds: [anna.id] } });

    const b = await openAs(browser, boss, info);
    await nav(b.page).getByRole('link', { name: 'Панель руководителя' }).click();
    await expect(b.page.getByRole('heading', { name: 'Панель руководителя' })).toBeVisible();
    await expect(b.page.getByTestId('tile-open')).toBeVisible();
    await expect(b.page.getByTestId('projects-by-status')).toContainText('В работе');
    await expect(b.page.getByTestId('late-projects')).toContainText(name);
    await expect(b.page.getByTestId('late-projects')).toContainText('Просрочено этапов: 1');
    await expect(b.page.getByTestId('overloaded')).toContainText(`${anna.fullName}`);
    await expect(b.page.getByTestId('overloaded')).toContainText('120%');
    await expect(b.page.getByTestId('waiting-decisions')).toContainText(`Решение ${name}`);
    await expect(b.page.getByTestId('waiting-decisions')).toContainText('Ждём ответа от: 1');
    await expect(b.page.getByTestId('all-good')).toHaveCount(0);
    await b.page.getByRole('button', { name: 'Обновить' }).click();
    await expect(b.page.getByTestId('late-projects')).toContainText(name);
    await b.ctx.close();

    const a = await openAs(browser, anna, info);
    await expect(nav(a.page).getByRole('link', { name: 'Панель руководителя' })).toHaveCount(0);
    await a.page.goto('/dashboard');
    await expect(a.page).toHaveURL(/\/$/);
    // her own start page counts what is hers
    await expect(a.page.getByTestId('home-docs')).toBeVisible();
    await expect(a.page.getByTestId('home-assignments-count')).toHaveText('0');
    await a.ctx.close();
  });

  test('the home page counts my open assignments and tasks', async ({ browser, request }, info) => {
    const lead = await createEmployee(request, 'lead', info, ['PROJECT_MANAGER']);
    const anna = await createEmployee(request, 'anna', info);
    const tl = await token(request, lead);
    for (const d of [3, 4]) await request.post('/api/assignments', { headers: auth(tl), data: { text: 'Дело', responsibleId: anna.id, dueDate: isoIn(d) } });
    await request.post('/api/tasks', { headers: auth(await token(request, anna)), data: { title: 'Моя задача', assigneeId: anna.id } });
    const a = await openAs(browser, anna, info);
    await expect(a.page.getByTestId('home-assignments-count')).toHaveText('2');
    await expect(a.page.getByTestId('home-tasks-count')).toHaveText('1');
    await a.page.getByTestId('home-assignments').click();
    await expect(a.page).toHaveURL(/\/assignments$/);
    await a.ctx.close();
  });
});
