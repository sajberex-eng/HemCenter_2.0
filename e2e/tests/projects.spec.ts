import { expect, test, type APIRequestContext } from '@playwright/test';
import { createEmployee, EMPLOYEE_PASSWORD, nav, openAs, type Person } from './helpers';

async function token(request: APIRequestContext, p: Person) {
  return (await (await request.post('/api/auth/login', { data: { login: p.login, password: EMPLOYEE_PASSWORD } })).json()).accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeProject(request: APIRequestContext, lead: Person, name: string, members: { userId: string; allocation: number }[]) {
  const res = await request.post('/api/projects', { headers: auth(await token(request, lead)), data: { name, members } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; chatId: string };
}

const isoIn = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);

test.describe('decisions in a project chat (П-3.2.1)', () => {
  test('two agree, one objects with a comment: the author sees "has objections" and the reason', async ({ browser, request }, info) => {
    const lead = await createEmployee(request, 'lead', info, ['PROJECT_MANAGER']);
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const carl = await createEmployee(request, 'carl', info);
    const pr = await makeProject(request, lead, 'Реестр поставщиков', [anna, boris, carl].map((p) => ({ userId: p.id, allocation: 10 })));
    const tl = await token(request, lead);
    await request.post(`/api/chats/${pr.chatId}/messages`, { headers: auth(tl), data: { body: 'Переходим на новый формат реестра' } });

    const l = await openAs(browser, lead, info);
    await l.page.goto(`/chats/${pr.chatId}`);
    const msg = l.page.getByTestId('message').filter({ hasText: 'Переходим на новый формат' });
    await msg.getByRole('button', { name: 'Действия' }).click();
    await msg.getByRole('button', { name: 'Решение с подтверждением' }).click();
    const dialog = l.page.getByRole('dialog', { name: 'Решение с подтверждением' });
    await expect(dialog.getByRole('button', { name: 'Создать' })).toBeDisabled(); // nobody chosen yet
    for (const p of [anna, boris, carl]) await dialog.getByRole('checkbox', { name: p.fullName, exact: true }).check();
    await dialog.getByRole('button', { name: 'Создать' }).click();
    await expect(l.page.getByTestId('decision-status')).toHaveText('Ждём ответов');

    const answer = async (p: Person, act: (page: import('@playwright/test').Page) => Promise<void>) => {
      const c = await openAs(browser, p, info);
      await c.page.goto(`/chats/${pr.chatId}`);
      await expect(c.page.getByTestId('decision-card')).toBeVisible();
      await act(c.page);
      await c.ctx.close();
    };
    await answer(anna, async (page) => {
      await page.getByTestId('decision-agree').click();
      await expect(page.getByTestId('decision-agree')).toHaveAttribute('aria-pressed', 'true');
    });
    await answer(boris, async (page) => {
      await page.getByTestId('decision-agree').click();
      await expect(page.getByTestId('decision-agree')).toHaveAttribute('aria-pressed', 'true');
    });
    await expect(l.page.getByTestId('decision-status')).toHaveText('Ждём ответов'); // live, two of three
    await answer(carl, async (page) => {
      await page.getByTestId('decision-object').click();
      await page.getByTestId('decision-send').click(); // no reason given
      await expect(page.getByRole('alert').filter({ hasText: 'Укажите причину возражения.' })).toBeVisible();
      await page.getByTestId('decision-comment').fill('Нет времени на переход');
      await page.getByTestId('decision-send').click();
      await expect(page.getByTestId('decision-status')).toHaveText('Есть возражения');
    });

    // the author's open page updated on its own and shows who said what
    await expect(l.page.getByTestId('decision-status')).toHaveText('Есть возражения');
    const rows = l.page.getByTestId('decision-response');
    await expect(rows.filter({ hasText: carl.fullName })).toContainText('Возражаю — Нет времени на переход');
    await expect(rows.filter({ hasText: anna.fullName })).toContainText('Согласен');
    await expect(l.page.getByText('Ответили: 3 из 3')).toBeVisible();
    // the author has no buttons of their own: they are not an addressee
    await expect(l.page.getByTestId('decision-agree')).toHaveCount(0);
    await l.ctx.close();
  });

  test('decisions waiting for an answer are listed under "My tasks"', async ({ browser, request }, info) => {
    const lead = await createEmployee(request, 'lead', info, ['PROJECT_MANAGER']);
    const anna = await createEmployee(request, 'anna', info);
    const pr = await makeProject(request, lead, 'Проект', [{ userId: anna.id, allocation: 10 }]);
    const tl = await token(request, lead);
    const m = await (await request.post(`/api/chats/${pr.chatId}/messages`, { headers: auth(tl), data: { body: 'Утверждаем график' } })).json();
    await request.post(`/api/chats/${pr.chatId}/messages/${m.id}/decision`, { headers: auth(tl), data: { text: 'Утверждаем график', addresseeIds: [anna.id] } });

    const a = await openAs(browser, anna, info);
    await nav(a.page).getByRole('link', { name: 'Мои задачи' }).click();
    const pending = a.page.getByTestId('pending-decisions');
    await expect(pending).toContainText('Утверждаем график');
    await pending.getByTestId('decision-ack').click();
    await expect(pending.getByTestId('decision-status')).toHaveText('Подтверждено');
    await a.page.reload();
    await expect(a.page.getByTestId('pending-decisions')).toHaveCount(0); // answered: no longer waiting
    await a.ctx.close();
  });
});

test.describe('tasks from messages (П-3.2.2)', () => {
  test('a task cannot be saved without a responsible person; once chosen it shows under the message and in "My tasks"', async ({ browser, request }, info) => {
    const lead = await createEmployee(request, 'lead', info, ['PROJECT_MANAGER']);
    const anna = await createEmployee(request, 'anna', info);
    const pr = await makeProject(request, lead, 'Смета', [{ userId: anna.id, allocation: 20 }]);
    const tl = await token(request, lead);
    await request.post(`/api/chats/${pr.chatId}/messages`, { headers: auth(tl), data: { body: 'Анна, нужна смета на ремонт' } });

    const l = await openAs(browser, lead, info);
    await l.page.goto(`/chats/${pr.chatId}`);
    const msg = l.page.getByTestId('message').filter({ hasText: 'нужна смета' });
    await msg.getByRole('button', { name: 'Действия' }).click();
    await msg.getByRole('button', { name: 'Создать задачу' }).click();
    const dialog = l.page.getByRole('dialog', { name: 'Создать задачу' });
    await dialog.getByRole('button', { name: 'Создать' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Выберите ответственного');
    await expect(l.page.getByTestId('task-card')).toHaveCount(0);

    await dialog.getByLabel('Ответственный', { exact: true }).selectOption({ label: anna.fullName });
    await dialog.getByLabel('Срок').fill(isoIn(-1));
    await dialog.getByRole('button', { name: 'Создать' }).click();
    const card = l.page.getByTestId('task-card');
    await expect(card).toContainText('Анна, нужна смета на ремонт');
    await expect(card).toContainText(`Ответственный: ${anna.fullName}`);
    await expect(card).toContainText('Просрочена');

    const a = await openAs(browser, anna, info);
    await nav(a.page).getByRole('link', { name: 'Мои задачи' }).click();
    const mine = a.page.getByTestId('my-task');
    await expect(mine).toHaveCount(1);
    await mine.getByLabel('Статус').selectOption('DONE');
    await a.page.reload();
    await expect(a.page.getByTestId('my-task')).toHaveCount(0); // finished tasks are hidden by default
    await a.page.getByLabel('Показать выполненные').check();
    await expect(a.page.getByTestId('my-task')).toHaveCount(1);
    // and the author's open chat shows the new status without a reload
    await expect(l.page.getByTestId('task-card')).toContainText('Выполнена');
    await expect(l.page.getByTestId('task-card').getByText('Просрочена')).toHaveCount(0);
    await a.ctx.close();
    await l.ctx.close();
  });
});

test.describe('projects and workload', () => {
  test('a manager creates a project with a team in the interface; a past milestone shows as overdue (П-3.3.1)', async ({ browser, request }, info) => {
    const lead = await createEmployee(request, 'lead', info, ['PROJECT_MANAGER']);
    const anna = await createEmployee(request, 'anna', info);
    const l = await openAs(browser, lead, info);
    await nav(l.page).getByRole('link', { name: 'Проекты' }).click();
    await l.page.getByRole('button', { name: 'Новый проект' }).click();
    await l.page.getByLabel('Название', { exact: true }).fill('Новый реестр');
    await l.page.getByRole('checkbox', { name: anna.fullName, exact: true }).check();
    await l.page.getByLabel(`Занятость, %: ${anna.fullName}`, { exact: true }).fill('35');
    await l.page.getByRole('button', { name: 'Создать' }).click();
    await expect(l.page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    await expect(l.page.getByRole('heading', { name: 'Новый реестр' })).toBeVisible();
    await expect(l.page.getByTestId('team-member').filter({ hasText: anna.fullName })).toContainText('35%');

    await l.page.getByLabel('Название этапа').fill('Сбор данных');
    await l.page.getByLabel('Срок', { exact: true }).first().fill(isoIn(-3));
    await l.page.getByRole('button', { name: 'Добавить этап' }).click();
    await expect(l.page.getByTestId('milestone-overdue')).toBeVisible();
    await l.page.getByRole('button', { name: 'Выполнен' }).click();
    await expect(l.page.getByTestId('milestone-overdue')).toHaveCount(0);

    // the project's chat exists and the team is in it
    await l.page.getByRole('link', { name: 'Чат проекта' }).click();
    await expect(l.page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
    await l.ctx.close();

    // a colleague outside the project does not see it; an ordinary employee has no "create" button
    const a = await openAs(browser, anna, info);
    await a.page.goto('/projects');
    await expect(a.page.getByTestId('project-item')).toHaveCount(1);
    await expect(a.page.getByRole('button', { name: 'Новый проект' })).toHaveCount(0);
    await expect(nav(a.page).getByRole('link', { name: 'Загрузка' })).toHaveCount(0);
    await a.ctx.close();
  });

  test('50% + 40% + 30% = 120%: a warning in the profile, in the matrix and in the project card (П-3.4.1)', async ({ browser, request }, info) => {
    const lead = await createEmployee(request, 'lead', info, ['PROJECT_MANAGER']);
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    let last = '';
    for (const [i, share] of [50, 40, 30].entries()) last = (await makeProject(request, lead, `Проект ${i + 1}`, [{ userId: anna.id, allocation: share }, ...(i === 0 ? [{ userId: boris.id, allocation: 60 }] : [])])).id;

    const a = await openAs(browser, anna, info);
    await a.page.goto('/profile');
    await expect(a.page.getByTestId('my-workload-total')).toHaveText('⚠ Загрузка 120% — больше 100%');
    await a.ctx.close();

    const b = await openAs(browser, boris, info);
    await b.page.goto('/profile');
    await expect(b.page.getByTestId('my-workload-total')).toHaveText('Загрузка 60%'); // no false alarm
    await b.ctx.close();

    const l = await openAs(browser, lead, info);
    await nav(l.page).getByRole('link', { name: 'Загрузка' }).click();
    const row = l.page.getByTestId('matrix-row').filter({ hasText: anna.fullName });
    await expect(row.getByTestId('matrix-overload')).toContainText('120%');
    // her three shares are in the row (other columns may exist from other projects)
    for (const share of ['50%', '40%', '30%']) await expect(row.getByRole('cell', { name: share, exact: true })).toHaveCount(1);
    await expect(l.page.getByTestId('matrix-row').filter({ hasText: boris.fullName }).getByTestId('matrix-overload')).toHaveCount(0);
    await l.page.goto(`/projects/${last}`);
    await expect(l.page.getByTestId('team-member').filter({ hasText: anna.fullName }).getByTestId('overload')).toBeVisible();
    await l.ctx.close();
  });
});
