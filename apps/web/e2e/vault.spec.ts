import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';
import {
  createdPrfCredential,
  newCredential,
  virtualAuthenticator,
  withoutAutofill,
} from './passkeys.js';
import { resetRateLimits, seedAccount } from './postgres/accounts.js';
import { reportViolations, watchProblems } from './problems.js';
import { databaseServer } from './servers.js';

test.skip(!databaseServer.enabled, 'needs ARCA_E2E_DATABASE and a Postgres (see README)');
test.beforeAll(async () => {
  await resetRateLimits();
});

test.beforeEach(async ({ page }) => {
  await reportViolations(page);
  await withoutAutofill(page);
});

async function signIn(page: Page, email: string) {
  await page.goto(`${databaseServer.origin}/sign-in`);
  await page.getByRole('button', { name: 'Entrar com chave de acesso' }).click();
  await expect(page.getByText(`Você entrou como ${email}.`)).toBeVisible();
}

async function openVaultPage(page: Page) {
  await page.goto(`${databaseServer.origin}/`);
  await page.getByRole('link', { name: 'Cofre' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Cofre' })).toBeVisible();
}

async function expectAccessible(page: Page) {
  expect(await new AxeBuilder({ page }).analyze().then(({ violations }) => violations)).toEqual([]);
}

const opened = (page: Page) => page.getByText(/^O cofre está aberto neste dispositivo\./);

/** Creates the vault and keeps the secret it shows once, as a person writing it down would. */
async function setUp(page: Page): Promise<{ secret: string; upload: Request }> {
  const upload = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/v1/vault'),
  );
  await page.getByRole('button', { name: 'Criar meu cofre' }).click();
  const sheet = page.getByRole('group', { name: 'Segredo de recuperação do cofre' });
  await expect(sheet).toBeVisible();
  const secret = (await sheet.locator('p').nth(1).innerText()).trim();
  expect(secret).toMatch(/^[0-9A-Z]{4}( [0-9A-Z]{1,4}){6}$/);
  await expectAccessible(page);
  await page.getByLabel('Guardei o segredo num lugar seguro').check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(opened(page)).toBeVisible();
  return { secret, upload: await upload };
}

test('with PRF, the passkey seals and opens the vault, which stays only in memory', async ({
  page,
}) => {
  const problems = watchProblems(page);
  const { credential, userId } = await createdPrfCredential(page);
  const { email } = await seedAccount(credential, userId);
  await signIn(page, email);
  await openVaultPage(page);

  const { upload } = await setUp(page);
  const body = upload.postDataJSON() as {
    passkeyEnvelopes: { credentialId: string }[];
    recoveryEnvelope: string;
  };
  expect(body.passkeyEnvelopes.map(({ credentialId }) => credentialId)).toEqual([
    credential.credentialId,
  ]);

  await page.getByRole('button', { name: 'Fechar o cofre' }).click();
  await page.getByRole('button', { name: 'Abrir o cofre' }).click();
  await expect(opened(page)).toBeVisible();

  // A reload drops the identity: it lives in memory only.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Abrir o cofre' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir o cofre' }).click();
  await expect(opened(page)).toBeVisible();
  expect(problems).toEqual([]);
});

test('without PRF, the recovery secret opens the vault and the device keeps it wrapped', async ({
  page,
}) => {
  const problems = watchProblems(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  await virtualAuthenticator(page, credential, { userId });
  await signIn(page, email);
  await openVaultPage(page);

  const { secret, upload } = await setUp(page);
  expect((upload.postDataJSON() as { passkeyEnvelopes: unknown[] }).passkeyEnvelopes).toEqual([]);

  // The wrapped identity opens the vault again on this device, after the step-up.
  await page.reload();
  const stepUp = page.waitForRequest((request) =>
    request.url().endsWith('/v1/auth/step-up/verify'),
  );
  await page.getByRole('button', { name: 'Abrir o cofre' }).click();
  await stepUp;
  await expect(opened(page)).toBeVisible();

  // Signing out deletes it, so the next unlock needs the secret: the recovery envelope opens.
  await page.goto(`${databaseServer.origin}/enroll#${'A'.repeat(43)}`);
  await page.getByRole('button', { name: 'Sair desta conta' }).click();
  await signIn(page, email);
  await openVaultPage(page);
  await page.getByRole('button', { name: 'Abrir o cofre' }).click();
  const field = page.getByLabel('Segredo de recuperação do cofre');
  await expectAccessible(page);
  await field.fill('0000 0000 0000 0000 0000 0000 00');
  await page.getByRole('button', { name: 'Abrir com o segredo' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Esse segredo não abre o cofre. Confira e tente de novo.',
  );
  await field.fill(secret.toLowerCase());
  await page.getByRole('button', { name: 'Abrir com o segredo' }).click();
  await expect(opened(page)).toBeVisible();
  expect(problems).toEqual([]);
});
