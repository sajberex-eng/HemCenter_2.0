import { expect, test, type Page } from '@playwright/test';
import { createEmployee, EMPLOYEE_PASSWORD, nav, openAs, type Person } from './helpers';

const ORIGIN = 'http://localhost:3000';
const composer = (page: Page) => page.getByRole('textbox', { name: 'Сообщение' });
const toast = (page: Page) => page.getByTestId('toast');

async function login(request: import('@playwright/test').APIRequestContext, p: Person) {
  const r = await request.post('/api/auth/login', { data: { login: p.login, password: EMPLOYEE_PASSWORD } });
  return (await r.json()).accessToken as string;
}

async function directChat(request: import('@playwright/test').APIRequestContext, from: Person, to: Person) {
  const token = await login(request, from);
  const chat = await (await request.post('/api/chats/direct', { headers: { Authorization: `Bearer ${token}` }, data: { userId: to.id } })).json();
  return { id: chat.id as string, token };
}

const say = (request: import('@playwright/test').APIRequestContext, token: string, chatId: string, body: string, extra: object = {}) =>
  request.post(`/api/chats/${chatId}/messages`, { headers: { Authorization: `Bearer ${token}` }, data: { body, ...extra } });

test.describe('in-app notifications', () => {
  test('a message in another chat pops up with sender and text; clicking opens the chat', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const b = await openAs(browser, boris, info);
    await b.page.goto('/staff');

    const chat = await directChat(request, anna, boris);
    await say(request, chat.token, chat.id, 'Совещание переносится на 15:00');
    await expect(toast(b.page)).toBeVisible();
    await expect(toast(b.page)).toContainText(anna.fullName);
    await expect(toast(b.page)).toContainText('Совещание переносится на 15:00');

    await toast(b.page).click();
    await expect(b.page).toHaveURL(new RegExp(`/chats/${chat.id}$`));
    await expect(toast(b.page)).toHaveCount(0);
    await b.ctx.close();
  });

  test('no pop-up for the chat that is open, for own messages, or for muted chats', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const b = await openAs(browser, boris, info);
    const chat = await directChat(request, anna, boris);

    // Boris is looking at this very chat
    await b.page.goto(`/chats/${chat.id}`);
    await say(request, chat.token, chat.id, 'виден сразу');
    await expect(b.page.getByTestId('message').filter({ hasText: 'виден сразу' })).toBeVisible();
    await expect(toast(b.page)).toHaveCount(0);

    // he leaves and mutes the chat: nothing pops up, but the unread counter still counts
    await b.page.goto('/staff');
    const bToken = await login(request, boris);
    await request.patch(`/api/chats/${chat.id}/me`, { headers: { Authorization: `Bearer ${bToken}` }, data: { notifyMode: 'NONE' } });
    await b.page.reload();
    await say(request, chat.token, chat.id, 'тихое сообщение');
    await expect(nav(b.page).getByLabel('1')).toBeVisible();
    await expect(toast(b.page)).toHaveCount(0);

    // "mentions only": an ordinary message is silent, a mention is not
    await request.patch(`/api/chats/${chat.id}/me`, { headers: { Authorization: `Bearer ${bToken}` }, data: { notifyMode: 'MENTIONS' } });
    await b.page.reload();
    await say(request, chat.token, chat.id, 'обычное сообщение');
    await expect(nav(b.page).getByLabel('2')).toBeVisible();
    await expect(toast(b.page)).toHaveCount(0);
    await say(request, chat.token, chat.id, 'Борис, это вам', { mentionIds: [boris.id] });
    await expect(toast(b.page)).toContainText('Борис, это вам');
    await b.ctx.close();
  });

  test('do-not-disturb from the profile silences pop-ups until it is switched off', async ({ browser, request }, info) => {
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);
    const b = await openAs(browser, boris, info);
    const chat = await directChat(request, anna, boris);

    await b.page.goto('/profile');
    await b.page.getByRole('button', { name: 'На 1 час' }).click();
    await expect(b.page.getByTestId('dnd-until')).toContainText('Не беспокоить до');

    await b.page.goto('/staff');
    await say(request, chat.token, chat.id, 'во время режима');
    await expect(nav(b.page).getByLabel('1')).toBeVisible();
    await expect(toast(b.page)).toHaveCount(0);

    await b.page.goto('/profile');
    await b.page.getByRole('button', { name: 'Выключить режим' }).click();
    await expect(b.page.getByTestId('dnd-until')).toHaveCount(0);
    await b.page.goto('/staff');
    await say(request, chat.token, chat.id, 'после режима');
    await expect(toast(b.page)).toContainText('после режима');
    await b.ctx.close();
  });

  test('quiet hours are saved, validated and can be cleared', async ({ browser, request }, info) => {
    const boris = await createEmployee(request, 'boris', info);
    const b = await openAs(browser, boris, info);
    await b.page.goto('/profile');
    const section = b.page.getByRole('region', { name: 'Тихие часы' });
    await section.getByLabel('С').fill('22:00');
    await section.getByLabel('До').fill('07:00');
    await section.getByRole('button', { name: 'Сохранить' }).click();
    await expect(b.page.getByText('Сохранено')).toBeVisible();

    await b.page.reload();
    await expect(section.getByLabel('С')).toHaveValue('22:00');
    await expect(section.getByLabel('До')).toHaveValue('07:00');
    await section.getByRole('button', { name: 'Сбросить' }).click();
    await expect(section.getByLabel('С')).toHaveValue('');
    await b.ctx.close();
  });
});

test.describe('push onboarding', () => {
  test('a new employee is offered notifications once; "later" hides the offer for good', async ({ browser, request }, info) => {
    const boris = await createEmployee(request, 'boris', info);
    const b = await openAs(browser, boris, info);
    await b.page.goto('/');
    const prompt = b.page.getByTestId('push-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('Включить уведомления о новых сообщениях?');
    await prompt.getByRole('button', { name: 'Позже' }).click();
    await expect(prompt).toHaveCount(0);
    await b.page.reload();
    await b.page.waitForTimeout(800); // give the state check time to run
    await expect(b.page.getByTestId('push-prompt')).toHaveCount(0);

    // the setting itself stays available in the profile, and says the device is not subscribed yet
    await b.page.goto('/profile');
    await expect(b.page.getByTestId('push-state')).toHaveText('Выключены на этом устройстве');
    await expect(b.page.getByRole('button', { name: 'Включить уведомления' })).toBeVisible();
    await b.ctx.close();
  });
});

test.describe('service worker', () => {
  /** Opens a signed-in page, finds the worker's registration and returns a function that pushes a message into it. */
  async function withWorker(browser: import('@playwright/test').Browser, person: Person, info: import('@playwright/test').TestInfo) {
    const { ctx, page } = await openAs(browser, person, info);
    await ctx.grantPermissions(['notifications'], { origin: ORIGIN });
    const cdp = await ctx.newCDPSession(page);
    const regs: { registrationId: string; scopeURL: string }[] = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e: { registrations: typeof regs }) => regs.push(...e.registrations));
    await cdp.send('ServiceWorker.enable');
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await expect.poll(() => ctx.serviceWorkers().length).toBeGreaterThan(0);
    await expect.poll(() => regs.some((r) => r.scopeURL.startsWith(ORIGIN))).toBe(true);
    const registrationId = regs.find((r) => r.scopeURL.startsWith(ORIGIN))!.registrationId;
    const push = (data: string) => cdp.send('ServiceWorker.deliverPushMessage', { origin: ORIGIN, registrationId, data });
    const shown = () => ctx.serviceWorkers()[0].evaluate(async () => (await self.registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, url: (n.data as { url: string }).url })));
    return { ctx, page, push, shown };
  }

  const payload = JSON.stringify({ title: 'HemCenter', body: 'Новое сообщение от Иванов А.', tag: 'chat:abc', url: '/chats/abc' });

  test('shows a system notification when no window is open, and stays silent when the app is on screen', async ({ browser, request }, info) => {
    const boris = await createEmployee(request, 'boris', info);
    const w = await withWorker(browser, boris, info);

    await w.push(payload);
    await w.page.waitForTimeout(700);
    expect(await w.shown()).toEqual([]); // the app is visible: it shows messages itself

    await w.page.goto('about:blank'); // no window of the site any more
    await w.push(payload);
    await expect.poll(() => w.shown()).toEqual([{ title: 'HemCenter', body: 'Новое сообщение от Иванов А.', tag: 'chat:abc', url: '/chats/abc' }]);

    // a second push for the same chat replaces the first one instead of stacking
    await w.push(JSON.stringify({ title: 'HemCenter', body: 'Новое сообщение от Петров В.', tag: 'chat:abc', url: '/chats/abc' }));
    await expect.poll(async () => (await w.shown()).map((n) => n.body)).toEqual(['Новое сообщение от Петров В.']);
    await w.ctx.close();
  });

  test('a broken or hostile payload becomes a harmless generic notification', async ({ browser, request }, info) => {
    const boris = await createEmployee(request, 'boris', info);
    const w = await withWorker(browser, boris, info);
    await w.page.goto('about:blank');
    await w.push('this is not json');
    await expect.poll(() => w.shown()).toEqual([{ title: 'HemCenter', body: 'Новое сообщение', tag: 'hemcenter', url: '/chats' }]);
    await w.push(JSON.stringify({ title: 'HemCenter', body: 'x', tag: 'evil', url: 'https://evil.example.com/steal' }));
    await expect.poll(async () => (await w.shown()).find((n) => n.tag === 'evil')?.url).toBe('/chats'); // never leaves the site
    await w.ctx.close();
  });
});
