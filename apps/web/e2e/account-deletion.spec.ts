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

async function signIn(page: Page, email: string) {
  await withoutAutofill(page);
  await page.goto(`${databaseServer.origin}/sign-in`);
  await page.getByRole('button', { name: 'Entrar com chave de acesso' }).click();
  await expect(page.getByText(`Você entrou como ${email}.`)).toBeVisible();
}

test('requests the deletion, then a new sign-in can only cancel it', async ({ page }) => {
  const problems = watchProblems(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  await virtualAuthenticator(page, credential, { userId });
  await signIn(page, email);
  await page.goto(`${databaseServer.origin}/settings`);

  const stepUp = page.waitForRequest((request) =>
    request.url().endsWith('/v1/auth/step-up/options'),
  );
  await page.getByRole('button', { name: 'Excluir minha conta' }).click();
  await page.getByRole('button', { name: 'Confirmar exclusão' }).click();
  await expect(page.getByRole('region', { name: 'Excluir conta' }).getByRole('status')).toHaveText(
    /^Pedido recebido\. A conta será apagada a partir de /,
  );
  expect((await stepUp).postDataJSON()).toMatchObject({
    purpose: 'account_deletion',
    target: { action: 'requestAccountDeletion', targets: [] },
  });

  // Every session ended, this one too: signing in again shows only the cancel.
  await signIn(page, email);
  await page.goto(`${databaseServer.origin}/`);
  await expect(page.getByText(/^Sua conta será apagada a partir de /)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Dispositivos' })).toHaveCount(0);
  const devices = await page.request.get(`${databaseServer.origin}/v1/devices`);
  expect(devices.status()).toBe(403);

  await page.getByRole('button', { name: 'Cancelar a exclusão' }).click();
  await expect(page.getByRole('link', { name: 'Dispositivos' })).toBeVisible();
  await expect(page.getByText(/^Sua conta será apagada a partir de /)).toHaveCount(0);
  expect(problems).toEqual([]);
});
