import { expect, test } from '@playwright/test';
import { ADMIN, createEmployee, nav, openAs, signIn } from './helpers';

test.describe('system status', () => {
  test('the administrator sees the state of the system; an employee has no such page', async ({ page, browser, request }, info) => {
    await signIn(page, ADMIN.login, ADMIN.password);
    await nav(page).getByRole('link', { name: 'Состояние системы' }).click();
    await expect(page.getByRole('heading', { name: 'Состояние системы' })).toBeVisible();
    await expect(page.getByTestId('sys-db')).toContainText('работает');
    await expect(page.getByTestId('sys-disk')).toContainText('Свободно');
    await expect(page.getByTestId('sys-files')).toContainText('файлов');
    await expect(page.getByTestId('sys-users')).toContainText('активных');

    const anna = await createEmployee(request, 'anna', info);
    const a = await openAs(browser, anna, info);
    await expect(nav(a.page).getByRole('link', { name: 'Состояние системы' })).toHaveCount(0);
    await a.page.goto('/admin/system');
    await expect(a.page).toHaveURL(/\/$/);
    await a.ctx.close();
  });
});
