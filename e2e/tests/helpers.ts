import { expect, type Page } from '@playwright/test';

export const ADMIN = {
  login: process.env.E2E_ADMIN_LOGIN ?? 'e2e-admin',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'E2e-admin-pass-1',
};
export const EMPLOYEE_PASSWORD = 'Employee-pass-123';

export async function signIn(page: Page, login: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/Логин|Логин/).fill(login);
  await page.getByLabel(/Пароль|Құпиясөз/).fill(password);
  await page.getByRole('button', { name: /Войти|Кіру/ }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** The bottom bar (phone) and the sidebar (desktop) both hold the nav; pick whichever is visible. */
export const nav = (page: Page) => page.locator('nav:visible');

/** The app's own error box; Next also renders an invisible role=alert route announcer. */
export const errorBox = (page: Page) => page.locator('p[role="alert"]');

import type { APIRequestContext, Browser, BrowserContext, TestInfo } from '@playwright/test';

export interface Person {
  id: string;
  login: string;
  fullName: string;
}

/** Creates an active employee through the API (the onboarding UI is covered by flow.spec.ts). */
export async function createEmployee(request: APIRequestContext, label: string, info: TestInfo, roles: string[] = ['EMPLOYEE']): Promise<Person> {
  const stamp = `${info.project.name}${Date.now()}${Math.floor(Math.random() * 1000)}`.toLowerCase();
  const login = `${label}.${stamp}`;
  const fullName = `${label[0].toUpperCase()}${label.slice(1)} Тест${stamp}`;
  const adminToken = (await (await request.post('/api/auth/login', { data: { login: ADMIN.login, password: ADMIN.password } })).json()).accessToken;
  const created = await request.post('/api/users', { headers: { Authorization: `Bearer ${adminToken}` }, data: { login, fullName, roles } });
  if (created.status() !== 201) throw new Error(`could not create ${login}: ${created.status()}`);
  const { inviteToken, user } = await created.json();
  const accepted = await request.post('/api/auth/accept-invite', { data: { token: inviteToken, password: EMPLOYEE_PASSWORD, consent: true } });
  if (accepted.status() !== 200) throw new Error(`could not activate ${login}`);
  return { id: user.id, login, fullName };
}

/** A separate browser context (own cookies) signed in as the given person. */
export async function openAs(browser: Browser, person: Person, info: TestInfo): Promise<{ ctx: BrowserContext; page: import('@playwright/test').Page }> {
  const ctx = await browser.newContext({ ...info.project.use });
  const page = await ctx.newPage();
  await signIn(page, person.login, EMPLOYEE_PASSWORD);
  return { ctx, page };
}
