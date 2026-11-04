import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { newCredential, virtualAuthenticator, withoutAutofill } from './passkeys.js';
import { resetRateLimits, seedAccount } from './postgres/accounts.js';
import { reportViolations, watchProblems } from './problems.js';
import { databaseServer } from './servers.js';

test.skip(!databaseServer.enabled, 'needs ARCA_E2E_DATABASE and a Postgres (see README)');
test.beforeAll(async () => {
  await resetRateLimits();
});

test.beforeEach(async ({ page }) => {
  await reportViolations(page);
});

const signInButton = (page: Page) =>
  page.getByRole('button', { name: 'Entrar com chave de acesso' });

async function expectSignedInAs(page: Page, email: string) {
  await expect(page.getByText(`Você entrou como ${email}.`)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  const cookies = await page.context().cookies(databaseServer.origin);
  expect(cookies.filter((cookie) => cookie.name.startsWith('__Host-arca'))).not.toEqual([]);
  for (const cookie of cookies) {
    expect(cookie, cookie.name).toMatchObject({ httpOnly: true, secure: true, path: '/' });
  }
}

test('signs in with the button and shows the account on the home page', async ({ page }) => {
  const problems = watchProblems(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  await virtualAuthenticator(page, credential, { userId });
  await withoutAutofill(page);

  await page.goto(`${databaseServer.origin}/`);
  await page.getByRole('link', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Entrar' })).toBeVisible();
  await expect(page.getByLabel('Conta')).toHaveCount(0);
  const box = await signInButton(page).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);

  const verify = page.waitForRequest((request) =>
    request.url().endsWith('/v1/auth/passkey/verify-authentication'),
  );
  await signInButton(page).click();
  await expectSignedInAs(page, email);
  // The authenticator supports PRF, yet no PRF output leaves the device (spec 0003, R3).
  const sent = (await verify).postDataJSON() as { response: Record<string, unknown> };
  expect(sent.response['clientExtensionResults']).toEqual({});
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  expect(problems).toEqual([]);
});

/** The autofill tests need a browser that offers passkeys in autofill; CI's Chromium does. */
async function requireAutofill(page: Page) {
  await page.goto(`${databaseServer.origin}/`);
  const conditional = await page.evaluate(() =>
    PublicKeyCredential.isConditionalMediationAvailable(),
  );
  if (process.env['CI'] !== undefined) expect(conditional, 'autofill in CI Chromium').toBe(true);
  test.skip(!conditional, 'this browser offers no passkeys in autofill');
}

test('signs in from the passkey suggestions of the account field', async ({ page }) => {
  const problems = watchProblems(page);
  await requireAutofill(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  await virtualAuthenticator(page, credential, { userId });
  await page.goto(`${databaseServer.origin}/sign-in`);
  await expectSignedInAs(page, email);
  expect(problems).toEqual([]);
});

test('offers the account field again after a refused pick', async ({ page }) => {
  await requireAutofill(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  const authenticator = await virtualAuthenticator(page, newCredential(), { userId: randomUUID() });
  await page.goto(`${databaseServer.origin}/sign-in`);
  await expect(page.getByRole('status')).toHaveText(
    'Essa chave de acesso não está ligada a nenhuma conta do Arca. Tente com outra.',
  );
  await authenticator.hold(credential, userId);
  await expectSignedInAs(page, email);
});

test('refuses options that ask to evaluate PRF, before any assertion is sent', async ({ page }) => {
  const credential = newCredential();
  const { userId } = await seedAccount(credential);
  await virtualAuthenticator(page, credential, { userId });
  await withoutAutofill(page);
  await page.route('**/v1/auth/passkey/generate-authenticate-options', async (route) => {
    const response = await route.fetch();
    const options = (await response.json()) as Record<string, unknown>;
    const first = randomBytes(32).toString('base64url');
    await route.fulfill({
      response,
      json: { ...options, extensions: { prf: { eval: { first } } } },
    });
  });
  const verified: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/verify-authentication')) verified.push(request.url());
  });

  await page.goto(`${databaseServer.origin}/sign-in`);
  await signInButton(page).click();
  await expect(page.getByRole('status')).toHaveText('Não deu certo desta vez. Tente de novo.');
  expect(verified).toEqual([]);
});

test('says so when the passkey opens no account', async ({ page }) => {
  const credential = newCredential();
  await virtualAuthenticator(page, credential, { userId: randomUUID() });
  await withoutAutofill(page);

  await page.goto(`${databaseServer.origin}/sign-in`);
  await signInButton(page).click();
  await expect(page.getByRole('status')).toHaveText(
    'Essa chave de acesso não está ligada a nenhuma conta do Arca. Tente com outra.',
  );
  await expect(signInButton(page)).toBeEnabled();
});

test('treats a ceremony without user verification as cancelled', async ({ page }) => {
  const credential = newCredential();
  const { userId } = await seedAccount(credential);
  await virtualAuthenticator(page, credential, { userId, userVerified: false });
  await withoutAutofill(page);

  await page.goto(`${databaseServer.origin}/sign-in`);
  await signInButton(page).click();
  await expect(page.getByRole('status')).toHaveText(
    'Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.',
  );
});
