import { expect, test } from '@playwright/test';
import { createEmployee, nav, openAs } from './helpers';

test.describe('meetings and protocols (П-3.5.1)', () => {
  test('a meeting with 3 agenda points, 2 decisions and 3 instructions becomes a protocol document', async ({ browser, request }, info) => {
    const chair = await createEmployee(request, 'chair', info);
    const anna = await createEmployee(request, 'anna', info);
    const boris = await createEmployee(request, 'boris', info);

    const c = await openAs(browser, chair, info);
    await nav(c.page).getByRole('link', { name: 'Совещания' }).click();
    await expect(c.page.getByRole('link', { name: 'Новое совещание' })).toBeVisible();
    await c.page.getByRole('link', { name: 'Новое совещание' }).click();
    await c.page.getByLabel('Тема', { exact: true }).fill('Планёрка по закупкам');
    await c.page.getByLabel('Дата и время').fill('2026-10-20T10:00');
    await c.page.getByLabel('Место или ссылка').fill('Кабинет 12');
    await c.page.getByLabel('Повестка (по одному пункту в строке)').fill('Реестр поставщиков\nГрафик отпусков\nРазное');
    await c.page.getByRole('checkbox', { name: anna.fullName, exact: true }).check();
    await c.page.getByRole('checkbox', { name: boris.fullName, exact: true }).check();
    await c.page.getByRole('button', { name: 'Создать' }).click();
    await expect(c.page).toHaveURL(/\/meetings\/[0-9a-f-]{36}$/);
    await expect(c.page.getByRole('heading', { name: 'Планёрка по закупкам' })).toBeVisible();
    const items = c.page.getByTestId('agenda-item');
    await expect(items).toHaveCount(3);
    await expect(c.page.getByTestId('participants')).toContainText(anna.fullName);

    // point 1: what was heard, a decision and an instruction
    await items.nth(0).getByLabel('Слушали: Реестр поставщиков').fill('Доклад о новых поставщиках');
    await items.nth(0).getByLabel('Слушали: Реестр поставщиков').blur();
    await items.nth(0).getByRole('button', { name: 'Решили' }).click();
    await items.nth(0).getByLabel('Текст решения').fill('Утвердить реестр поставщиков');
    await items.nth(0).getByRole('button', { name: 'Создать' }).click();
    await items.nth(0).getByRole('button', { name: 'Поручили' }).click();
    await items.nth(0).getByLabel('Что поручено').fill('Разослать реестр отделам');
    // an instruction cannot be saved without a person and a date
    await expect(items.nth(0).getByRole('button', { name: 'Создать' })).toBeDisabled();
    await items.nth(0).getByLabel('Ответственный', { exact: true }).selectOption({ label: anna.fullName });
    await items.nth(0).getByLabel('Срок', { exact: true }).fill('2026-11-01');
    await items.nth(0).getByRole('button', { name: 'Создать' }).click();
    await expect(items.nth(0).getByTestId('resolution')).toHaveCount(2);

    // point 2: a decision and two instructions
    await items.nth(1).getByRole('button', { name: 'Решили' }).click();
    await items.nth(1).getByLabel('Текст решения').fill('Принять график отпусков');
    await items.nth(1).getByRole('button', { name: 'Создать' }).click();
    for (const [text, who, due] of [['Подготовить приказ об отпусках', boris, '2026-11-05'], ['Ознакомить сотрудников', anna, '2026-11-10']] as const) {
      await items.nth(1).getByRole('button', { name: 'Поручили' }).click();
      await items.nth(1).getByLabel('Что поручено').fill(text);
      await items.nth(1).getByLabel('Ответственный', { exact: true }).selectOption({ label: who.fullName });
      await items.nth(1).getByLabel('Срок', { exact: true }).fill(due);
      await items.nth(1).getByRole('button', { name: 'Создать' }).click();
    }
    await expect(items.nth(1).getByTestId('resolution')).toHaveCount(3);

    // a participant sees the record but cannot change it or make the protocol
    const a = await openAs(browser, anna, info);
    await a.page.goto('/meetings');
    await a.page.getByTestId('meeting-item').filter({ hasText: 'Планёрка по закупкам' }).click();
    await expect(a.page.getByTestId('agenda-item').first()).toContainText('Утвердить реестр поставщиков');
    await expect(a.page.getByRole('button', { name: 'Сформировать протокол' })).toHaveCount(0);
    await expect(a.page.getByRole('button', { name: 'Добавить пункт' })).toHaveCount(0);
    await a.ctx.close();

    // the protocol
    await c.page.getByRole('button', { name: 'Сформировать протокол' }).click();
    await c.page.getByRole('link', { name: 'Открыть протокол' }).click();
    await expect(c.page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
    await expect(c.page.getByRole('heading', { name: /Протокол совещания «Планёрка по закупкам» от 20\.10\.2026/ })).toBeVisible();
    await expect(c.page.getByTestId('document-status')).toHaveText('Черновик');
    const card = c.page.locator('dl').first();
    for (const must of ['Реестр поставщиков', 'График отпусков', 'Разное', 'Слушали: Доклад о новых поставщиках', 'Утвердить реестр поставщиков (п. 1 повестки)', 'Принять график отпусков (п. 2 повестки)']) await expect(card).toContainText(must);
    await expect(card).toContainText(`Разослать реестр отделам (п. 1 повестки) — ${anna.fullName}, 01.11.2026`);
    await expect(card).toContainText(`Подготовить приказ об отпусках (п. 2 повестки) — ${boris.fullName}, 05.11.2026`);
    await expect(card).toContainText(`Ознакомить сотрудников (п. 2 повестки) — ${anna.fullName}, 10.11.2026`);

    // sent for approval: the record behind it is locked
    await c.page.getByRole('button', { name: 'Добавить согласующего' }).click();
    await c.page.getByLabel('Согласующий 1', { exact: true }).selectOption({ value: boris.id });
    await c.page.getByRole('button', { name: 'Отправить на согласование' }).click();
    await expect(c.page.getByTestId('document-status')).toHaveText('На согласовании');
    await c.page.goBack(); // to the meeting
    await expect(c.page.getByTestId('locked-note')).toBeVisible();
    await expect(c.page.getByRole('button', { name: 'Добавить пункт' })).toHaveCount(0);
    await c.ctx.close();
  });
});
