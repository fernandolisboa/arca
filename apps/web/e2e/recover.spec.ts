import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { newCredential, virtualAuthenticator, withoutAutofill } from './passkeys.js';
import {
  endPasskeyWaits,
  latestEmailTo,
  resetRateLimits,
  seedAccount,
  seedRecoveryCode,
} from './postgres/accounts.js';
import { reportViolations, watchProblems } from './problems.js';
import { databaseServer } from './servers.js';

test.skip(!databaseServer.enabled, 'needs ARCA_E2E_DATABASE and a Postgres (see README)');
test.beforeAll(async () => {
  await resetRateLimits();
});

test.beforeEach(async ({ page }) => {
  await reportViolations(page);
});

async function expectAccessible(page: Page) {
  expect(await new AxeBuilder({ page }).analyze().then(({ violations }) => violations)).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
}

/** An account with one passkey, a saved kit and a session this page signed in. */
async function signedInOwner(page: Page) {
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  const code = await seedRecoveryCode(userId);
  const authenticator = await virtualAuthenticator(page, credential, { userId });
  await withoutAutofill(page);
  await page.goto(`${databaseServer.origin}/sign-in`);
  await page.getByRole('button', { name: 'Entrar com chave de acesso' }).click();
  await expect(page.getByText(`Você entrou como ${email}.`)).toBeVisible();
  return { credential, userId, email, code, authenticator };
}

/**
 * Recovery in a browser with no session and an empty authenticator, as on a new phone: the link
 * from the outbox, the code typed loosely, the new code kept, then the new passkey.
 */
async function recoverIn(browser: Browser, page: Page, email: string, code: string) {
  const context = await browser.newContext({
    viewport: page.viewportSize(),
    isMobile: test.info().project.name === 'phone',
    hasTouch: test.info().project.name === 'phone',
  });
  const recovering = await context.newPage();
  await reportViolations(recovering);
  const problems = watchProblems(recovering);
  const authenticator = await virtualAuthenticator(recovering, newCredential(), {
    userId: '00000000-0000-4000-8000-000000000000',
  });
  await authenticator.clear();

  await recovering.goto(`${databaseServer.origin}/sign-in`);
  await recovering.getByRole('link', { name: 'Recuperar a conta' }).click();
  await expect(
    recovering.getByRole('heading', { level: 2, name: 'Recuperar a conta' }),
  ).toBeVisible();
  await recovering.getByLabel('Email').fill(email);
  await recovering.getByRole('button', { name: 'Enviar o link' }).click();
  await expect(recovering.getByRole('status')).toHaveText(
    'Se esse email tiver uma conta no Arca, o link já está a caminho. Ele vale por 30 minutos.',
  );
  await expectAccessible(recovering);

  // The link is sent behind the answer, so it may land a moment after the status shows.
  const recoveryLink = async () =>
    (await latestEmailTo(email, '/recover#'))?.match(
      /http:\/\/\S+\/recover#[A-Za-z0-9_-]{43}/,
    )?.[0];
  await expect.poll(recoveryLink).toBeDefined();
  const link = await recoveryLink();
  await recovering.goto(link ?? '');
  await expect(recovering).toHaveURL(`${databaseServer.origin}/recover`);
  await recovering
    .getByRole('textbox', { name: 'Código de recuperação' })
    .fill(`${code.slice(0, 4).toLowerCase()} ${code.slice(4, 8)}-${code.slice(8)}`);
  await recovering.getByRole('button', { name: 'Continuar' }).click();
  await expect(
    recovering.getByRole('heading', { level: 2, name: 'Seu novo código de recuperação' }),
  ).toBeVisible();
  await expectAccessible(recovering);
  await recovering.getByLabel('Guardei o código num lugar seguro').check();
  await recovering.getByRole('button', { name: 'Continuar' }).click();
  await recovering.getByRole('button', { name: 'Criar chave de acesso' }).click();
  await expect(
    recovering.getByRole('heading', { level: 2, name: 'Chave nova criada' }),
  ).toBeVisible();
  await expectAccessible(recovering);

  // The ceremony opens no session.
  expect((await recovering.request.get(`${databaseServer.origin}/v1/session`)).status()).toBe(401);
  expect(problems).toEqual([]);
  await context.close();
}

test('recovers from the link and the code, restricting the old session until it cancels', async ({
  page,
  browser,
}) => {
  const problems = watchProblems(page);
  const { credential, userId, email, code, authenticator } = await signedInOwner(page);
  await recoverIn(browser, page, email, code);

  await page.goto(`${databaseServer.origin}/`);
  await expect(page.getByText(/^Alguém pediu a recuperação da sua conta/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Convidar alguém' })).toHaveCount(0);
  const refused = await page.request.get(`${databaseServer.origin}/v1/invites`);
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ error: { code: 'recovery_pending' } });

  await page.getByRole('link', { name: 'Cancelar a recuperação' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Dispositivos' })).toBeVisible();
  await expect(page.getByText(/^Nova chave de acesso \(recuperação\)\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adicionar chave de acesso' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remover esta chave' })).toHaveCount(0);
  await expectAccessible(page);

  // The old passkey approves the cancel; its counter must keep rising past the sign-in.
  await authenticator.hold(credential, userId, 100);
  await page.getByRole('button', { name: 'Cancelar a recuperação' }).click();
  await expect(page.getByRole('status').first()).toHaveText(
    'Recuperação cancelada. O código de recuperação deixou de valer, então gere um novo kit de recuperação.',
  );
  await page.goto(`${databaseServer.origin}/`);
  await expect(page.getByText(/^Falta guardar o seu kit de recuperação\./)).toBeVisible();
  await expect(page.getByText(/^Alguém pediu a recuperação/)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('ends the restricted sessions once the recovery passkey becomes active', async ({
  page,
  browser,
}) => {
  const problems = watchProblems(page);
  const { userId, email, code } = await signedInOwner(page);
  await recoverIn(browser, page, email, code);
  await endPasskeyWaits(userId);
  expect((await page.request.get(`${databaseServer.origin}/v1/session`)).status()).toBe(401);
  expect(problems).toEqual([]);
});
