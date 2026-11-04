import AxeBuilder from '@axe-core/playwright';
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

async function openDevices(page: Page) {
  await page.goto(`${databaseServer.origin}/`);
  await page.getByRole('link', { name: 'Dispositivos' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Dispositivos' })).toBeVisible();
}

const passkeyCards = (page: Page) =>
  page
    .getByRole('list', { name: 'Suas chaves de acesso' })
    .getByRole('listitem')
    .filter({
      has: page.getByRole('button', { name: /^(Remover|Cancelar) esta chave$/ }),
    });

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
}

test('adds a passkey that waits 24 hours, shows it to every session, and cancels it', async ({
  page,
}) => {
  const problems = watchProblems(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  const authenticator = await virtualAuthenticator(page, credential, { userId });
  await signIn(page, email);
  await openDevices(page);
  await expect(passkeyCards(page)).toHaveCount(1);
  await expect(page.getByText('Você entrou neste dispositivo com esta chave.')).toBeVisible();
  await expect(page.getByText('Este dispositivo', { exact: true })).toBeVisible();

  // The step-up signs with the held passkey; the browser then creates a new one, which an
  // authenticator already holding an excluded credential would refuse, so it is emptied between.
  await page.route('**/v1/devices/passkeys/options', async (route) => {
    const response = await route.fetch();
    await authenticator.clear();
    await route.fulfill({ response });
  });
  const stepUp = page.waitForRequest((request) =>
    request.url().endsWith('/v1/auth/step-up/options'),
  );
  await page.getByRole('button', { name: 'Adicionar chave de acesso' }).click();
  await expect(page.getByRole('status').first()).toHaveText(
    'Chave criada. Ela passa a valer daqui a 24 horas.',
  );
  expect((await stepUp).postDataJSON()).toMatchObject({
    purpose: 'sensitive_settings',
    target: { action: 'addPasskeyOptions', targets: [] },
  });
  await expect(passkeyCards(page)).toHaveCount(2);
  await expect(page.getByText(/^Chave nova\. Passa a valer em /)).toBeVisible();
  expect(await new AxeBuilder({ page }).analyze().then(({ violations }) => violations)).toEqual([]);
  await expectNoOverflow(page);

  await page.goto(`${databaseServer.origin}/`);
  await expect(page.getByText(/^Uma chave de acesso nova foi criada na sua conta\./)).toBeVisible();
  await page.getByRole('link', { name: 'Ver a chave nova' }).click();

  // Only the older, active passkey can approve the cancellation; its counter must keep rising.
  await authenticator.hold(credential, userId, 100);
  await page.getByRole('button', { name: 'Cancelar esta chave' }).click();
  await expect(page.getByRole('status').first()).toHaveText('Chave nova cancelada.');
  await expect(passkeyCards(page)).toHaveCount(1);
  await page.goto(`${databaseServer.origin}/`);
  await expect(page.getByText('Você entrou como', { exact: false })).toBeVisible();
  await expect(page.getByText(/^Uma chave de acesso nova/)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('disconnects another device, whose cookie then gets no session', async ({ page, browser }) => {
  const problems = watchProblems(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  const other = await browser.newPage();
  try {
    // Each authenticator counts its own signatures, so this one starts far ahead of the other.
    await virtualAuthenticator(other, credential, { userId });
    await signIn(other, email);
    await virtualAuthenticator(page, credential, { userId, signCount: 1000 });
    await signIn(page, email);

    await openDevices(page);
    const elsewhere = page.getByRole('button', { name: 'Desconectar este dispositivo' });
    await expect(elsewhere).toHaveCount(1);
    await elsewhere.click();
    await expect(page.getByRole('status').first()).toHaveText('Dispositivo desconectado.');
    await expect(elsewhere).toHaveCount(0);
    await expectNoOverflow(page);

    const revoked = await other.request.get(`${databaseServer.origin}/v1/session`);
    expect(revoked.status()).toBe(401);
    const kept = await page.request.get(`${databaseServer.origin}/v1/session`);
    expect(kept.status()).toBe(200);
  } finally {
    await other.close();
  }
  expect(problems).toEqual([]);
});
