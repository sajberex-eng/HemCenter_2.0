import { expect, test } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import { ADMIN, EMPLOYEE_PASSWORD, errorBox, signIn } from './helpers';

const codeAt = (secret: string, stepOffset = 0) =>
  new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30, algorithm: 'SHA1' }).generate({ timestamp: Date.now() + stepOffset * 30_000 });

test('employee enrols 2FA, then signs in with an authenticator code and with a recovery code', async ({ page, request }, info) => {
  const login = `mfa.${info.project.name}${Date.now()}`.toLowerCase();

  // set up the account through the API (the UI path is covered by flow.spec.ts)
  const adminToken = (await (await request.post('/api/auth/login', { data: { login: ADMIN.login, password: ADMIN.password } })).json()).accessToken;
  const created = await request.post('/api/users', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { login, fullName: `Мария 2FA ${login}`, roles: ['EMPLOYEE'] },
  });
  expect(created.status()).toBe(201);
  const { inviteToken } = await created.json();
  expect((await request.post('/api/auth/accept-invite', { data: { token: inviteToken, password: EMPLOYEE_PASSWORD, consent: true } })).status()).toBe(200);

  // enrol in the browser
  await signIn(page, login, EMPLOYEE_PASSWORD);
  await page.goto('/profile');
  await expect(page.getByText('Выключена')).toBeVisible();
  await page.getByRole('button', { name: 'Включить' }).click();
  await expect(page.getByAltText('QR')).toBeVisible();
  const secret = (await page.locator('code').first().innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);

  await page.getByLabel('Введите код из приложения, чтобы подтвердить').fill('000000');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(errorBox(page)).toHaveText('Неверный код.');

  await page.getByLabel('Введите код из приложения, чтобы подтвердить').fill(codeAt(secret));
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  const codes = await page.getByTestId('recovery-codes').locator('li').allInnerTexts();
  expect(codes).toHaveLength(10);
  await page.getByRole('button', { name: 'Я сохранил(а) коды' }).click();
  await expect(page.getByText('Включена')).toBeVisible();

  const logout = async () => {
    // the profile page has its own sign-out buttons too; the first match is the app shell's
    await page.getByRole('button', { name: 'Выйти', exact: true }).first().click();
    await expect(page).toHaveURL(/\/login$/);
  };
  const passwordStep = async () => {
    await page.getByLabel('Логин').fill(login);
    await page.getByLabel('Пароль').fill(EMPLOYEE_PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByRole('heading', { name: 'Подтверждение входа' })).toBeVisible();
  };

  // 1) the password alone is not enough; a wrong code is refused with its own message
  await logout();
  await passwordStep();
  await page.getByLabel('Код').fill('123456');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(errorBox(page)).toHaveText('Неверный код.');

  // 2) the authenticator code of the next 30-second step (the current one was used to enrol)
  await page.getByLabel('Код').fill(codeAt(secret, 1));
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page).toHaveURL(/\/$/);

  // 3) a recovery code works once
  await logout();
  await passwordStep();
  await page.getByLabel('Код').fill(codes[0]);
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page).toHaveURL(/\/$/);
  await logout();
  await passwordStep();
  await page.getByLabel('Код').fill(codes[0]);
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(errorBox(page)).toHaveText('Неверный код.');
});
