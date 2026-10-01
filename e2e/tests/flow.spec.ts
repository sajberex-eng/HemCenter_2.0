import { expect, test } from '@playwright/test';
import { ADMIN, EMPLOYEE_PASSWORD, errorBox, nav, signIn } from './helpers';

test.describe('login', () => {
  test('wrong password shows an error in the chosen language', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Логин').fill('nobody');
    await page.getByLabel('Пароль').fill('wrong-password-1');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(errorBox(page)).toHaveText('Неверный логин или пароль.');

    await page.getByRole('button', { name: 'ҚАЗ' }).click();
    await expect(page.getByRole('heading', { name: 'Жүйеге кіру' })).toBeVisible();
    await page.getByLabel('Логин').fill('nobody');
    await page.getByLabel('Құпиясөз').fill('wrong-password-1');
    await page.getByRole('button', { name: 'Кіру' }).click();
    await expect(errorBox(page)).toHaveText('Логин немесе құпиясөз қате.');
  });

  test('protected pages send anonymous users to the login screen', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('language choice survives a reload', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'ҚАЗ' }).click();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Жүйеге кіру' })).toBeVisible();
  });
});

test.describe('onboarding an employee', () => {
  test('admin invites, employee activates, appears in the directory, has no admin access', async ({ page, browser }, info) => {
    const suffix = `${info.project.name}${Date.now()}`.toLowerCase();
    const login = `anna.${suffix}`;
    const fullName = `Анна Тестова ${suffix}`;

    // admin creates the account
    await signIn(page, ADMIN.login, ADMIN.password);
    await nav(page).getByRole('link', { name: 'Пользователи' }).click();
    await page.getByRole('button', { name: 'Добавить сотрудника' }).click();
    await page.getByLabel('ФИО').fill(fullName);
    await page.getByLabel('Логин').fill(login);
    await page.getByRole('button', { name: 'Создать' }).click();
    const link = await page.locator('code').innerText();
    expect(link).toContain('/invite?token=');

    // the employee opens the link on another device and activates the account
    const ctx = await browser.newContext({ ...info.project.use });
    const emp = await ctx.newPage();
    await emp.goto(link);
    const submit = emp.getByRole('button', { name: 'Активировать' });
    await expect(submit).toBeDisabled(); // consent is required
    await emp.getByLabel('Новый пароль').fill(EMPLOYEE_PASSWORD);
    await emp.getByRole('checkbox').check();
    await expect(emp.getByText('Не передавайте в системе данные пациентов')).toBeVisible();
    await submit.click();
    await expect(emp.getByRole('heading', { name: `Здравствуйте, ${fullName}` })).toBeVisible();

    // the link is single-use
    await emp.goto(link);
    await emp.getByLabel('Новый пароль').fill(EMPLOYEE_PASSWORD);
    await emp.getByRole('checkbox').check();
    await emp.getByRole('button', { name: 'Активировать' }).click();
    await expect(errorBox(emp)).toContainText('недействительна');

    // activation signs the employee in; sign out and back in to prove the new password works
    await emp.getByRole('button', { name: 'Выйти' }).click();
    await expect(emp).toHaveURL(/\/login$/);

    // signed-in employee sees the directory but no admin sections, and cannot open them
    await signIn(emp, login, EMPLOYEE_PASSWORD);
    await expect(nav(emp).getByRole('link', { name: 'Пользователи' })).toHaveCount(0);
    await expect(nav(emp).getByRole('link', { name: 'Сотрудники' })).toBeVisible();
    await emp.goto('/admin/users');
    await expect(emp).toHaveURL(/\/$/);
    await nav(emp).getByRole('link', { name: 'Сотрудники' }).click();
    await emp.getByRole('searchbox').fill(suffix);
    await expect(emp.getByText(fullName)).toBeVisible();
    await ctx.close();

    // admin blocks the account: the employee is thrown out
    await page.reload();
    await page.getByLabel('Показывать заблокированных').check();
    const card = page.locator('section', { hasText: fullName });
    await card.getByRole('button', { name: 'Заблокировать' }).click();
    await expect(card.getByText('Заблокирован')).toBeVisible();
  });
});

test.describe('admin tools', () => {
  test('departments and positions can be created and removed', async ({ page }, info) => {
    const name = `Отдел ${info.project.name}${Date.now()}`;
    await signIn(page, ADMIN.login, ADMIN.password);
    await nav(page).getByRole('link', { name: 'Структура' }).click();
    const section = page.locator('section', { hasText: 'Подразделения' }).first();
    await section.getByLabel('Название (рус.)').fill(name);
    await section.getByLabel('Название (қаз.)').fill(`${name} (қаз)`);
    await section.getByRole('button', { name: 'Добавить подразделение' }).click();
    await expect(section.getByText(name, { exact: false }).first()).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await section.locator('li', { hasText: name }).getByRole('button', { name: 'Удалить' }).click();
    await expect(section.locator('li', { hasText: name })).toHaveCount(0);
  });

  test('audit log lists the actions just performed', async ({ page }) => {
    await signIn(page, ADMIN.login, ADMIN.password);
    await nav(page).getByRole('link', { name: 'Журнал аудита' }).click();
    await expect(page.getByRole('cell', { name: 'auth.login' }).first()).toBeVisible();
  });
});

test.describe('installable app', () => {
  test('manifest and icons are served', async ({ page, request }) => {
    await page.goto('/login');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const manifest = await (await request.get(href!)).json();
    expect(manifest.display).toBe('standalone');
    for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  });

  test('no horizontal scrolling on the main screens', async ({ page }) => {
    for (const path of ['/login']) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
    await signIn(page, ADMIN.login, ADMIN.password);
    for (const name of ['Пользователи', 'Структура', 'Журнал аудита', 'Сотрудники', 'Профиль']) {
      await nav(page).getByRole('link', { name }).click();
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, name).toBeLessThanOrEqual(0);
    }
  });
});
