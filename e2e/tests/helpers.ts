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
