import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { ADMIN, nav, signIn } from './helpers';

test.describe('audit log screen', () => {
  test('the administrator filters by kind of action and exports; the screen carries no private content', async ({ page }) => {
    await signIn(page, ADMIN.login, ADMIN.password);
    await nav(page).getByRole('link', { name: 'Журнал аудита' }).click();
    await expect(page.getByText('Содержание переписки и документов в него не выводится.')).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();

    await page.getByLabel('Действие', { exact: true }).selectOption('auth.');
    await page.getByRole('button', { name: 'Применить' }).click();
    await expect.poll(async () => (await page.locator('tbody td:nth-child(3)').allInnerTexts()).every((a) => a.startsWith('auth.'))).toBe(true);
    expect(await page.locator('tbody tr').count()).toBeGreaterThan(0);

    await page.getByLabel('С даты').fill('2001-01-01');
    await page.getByLabel('По дату').fill('2001-01-02');
    await page.getByRole('button', { name: 'Применить' }).click();
    await expect(page.getByText('Записей нет.')).toBeVisible();

    await page.getByLabel('С даты').fill('');
    await page.getByLabel('По дату').fill('');
    await page.getByRole('button', { name: 'Применить' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать CSV' }).click()]);
    expect(download.suggestedFilename()).toBe('audit.csv');
    const text = (await readFile((await download.path())!)).toString('utf8');
    expect(text.startsWith('﻿at,actor,action,entityType,entityId,ip')).toBe(true);
    expect(text.split('\r\n').slice(1).every((l) => l.includes('"auth.'))).toBe(true); // the filter applies to the export too
  });
});
