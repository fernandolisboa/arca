import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';
import {
  createdPrfCredential,
  newCredential,
  virtualAuthenticator,
  withoutAutofill,
} from './passkeys.js';
import { linkAccounts, resetRateLimits, seedAccount } from './postgres/accounts.js';
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
  const secret = await keepSecret(page);
  return { secret, upload: await upload };
}

/** Reads the vault secret shown once, checks the page, and confirms it was kept. */
async function keepSecret(page: Page): Promise<string> {
  const sheet = page.getByRole('group', { name: 'Segredo de recuperação do cofre' });
  await expect(sheet).toBeVisible();
  const secret = (await sheet.locator('p').nth(1).innerText()).trim();
  expect(secret).toMatch(/^[0-9A-Z]{4}( [0-9A-Z]{1,4}){6}$/);
  await expectAccessible(page);
  await page.getByLabel('Guardei o segredo num lugar seguro').check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(opened(page)).toBeVisible();
  return secret;
}

async function signOutAndIn(page: Page, email: string) {
  await page.goto(`${databaseServer.origin}/enroll#${'A'.repeat(43)}`);
  await page.getByRole('button', { name: 'Sair desta conta' }).click();
  await signIn(page, email);
}

/** The account part of the kit: shown, kept and confirmed. */
async function keepAccountCode(page: Page, button: string) {
  await page.goto(`${databaseServer.origin}/recovery-kit`);
  await page.getByRole('button', { name: button }).click();
  await expect(page.getByRole('group', { name: 'Código de recuperação' })).toBeVisible();
  await page.getByLabel('Guardei o código num lugar seguro').check();
  await page.getByRole('button', { name: 'Continuar' }).click();
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

test('keeps documents encrypted on the server, and changes one only after a vault_write step-up', async ({
  page,
}) => {
  const problems = watchProblems(page);
  const { credential, userId } = await createdPrfCredential(page);
  const { email } = await seedAccount(credential, userId, { confirmed: true });
  await signIn(page, email);
  await openVaultPage(page);
  await setUp(page);
  await expect(page.getByText(/^Ainda não há documentos no cofre\./)).toBeVisible();

  const fileName = 'certidao-exemplo.txt';
  const contents = 'synthetic birth certificate';
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/v1/vault/documents'),
  );
  const stored = page.waitForRequest((request) => request.method() === 'PUT');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Adicionar documento' }).click();
  await (
    await chooser
  ).setFiles({ name: fileName, mimeType: 'text/plain', buffer: Buffer.from(contents) });
  await expect(page.getByText('Documento guardado no cofre.')).toBeVisible();

  // The server sees neither the name nor the contents: only age ciphertext.
  const createRequest = (await created).request().postData() ?? '';
  expect(createRequest).not.toContain('certidao');
  const { documentId } = (await (await created).json()) as { documentId: string };
  const upload = (await stored).postDataBuffer() ?? Buffer.alloc(0);
  expect(upload.subarray(0, 21).toString()).toBe('age-encryption.org/v1');
  expect(upload.toString('latin1')).not.toContain(contents);

  const documents = page.getByRole('list', { name: 'Documentos' });
  await expect(documents.getByText(fileName)).toBeVisible();
  await expectAccessible(page);

  const download = page.waitForEvent('download');
  await documents.getByRole('button', { name: 'Baixar' }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe(fileName);
  const path = await saved.path();
  expect(await readFile(path, 'utf8')).toBe(contents);

  // The vault_unlock window alone changes nothing (spec 0005, R4).
  const refused = await page.request.post(`${databaseServer.origin}/v1/vault/documents/delete`, {
    headers: { origin: databaseServer.origin },
    data: { documentIds: [documentId] },
  });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ error: { code: 'step_up_required' } });
  await page.reload();
  await page.getByRole('button', { name: 'Abrir o cofre' }).click();
  await expect(documents.getByText(fileName)).toBeVisible();

  await documents.getByRole('button', { name: 'Apagar' }).click();
  await expect(page.getByText('Documento apagado.')).toBeVisible();
  await expect(page.getByText(/^Ainda não há documentos no cofre\./)).toBeVisible();
  expect(problems).toEqual([]);
});

test('shares a document with a linked account and takes the access back', async ({
  page,
  browser,
}) => {
  const problems = watchProblems(page);
  const owner = await createdPrfCredential(page);
  const { email: ownerEmail } = await seedAccount(owner.credential, owner.userId, {
    confirmed: true,
  });
  const relativeContext = await browser.newContext();
  const relativePage = await relativeContext.newPage();
  await withoutAutofill(relativePage);
  const relative = await createdPrfCredential(relativePage);
  const { email: relativeEmail } = await seedAccount(relative.credential, relative.userId, {
    confirmed: true,
  });
  await linkAccounts(owner.userId, relative.userId);

  await signIn(relativePage, relativeEmail);
  await openVaultPage(relativePage);
  await setUp(relativePage);

  await signIn(page, ownerEmail);
  await openVaultPage(page);
  await setUp(page);
  const fileName = 'passaporte-exemplo.txt';
  const contents = 'synthetic passport scan';
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Adicionar documento' }).click();
  await (
    await chooser
  ).setFiles({ name: fileName, mimeType: 'text/plain', buffer: Buffer.from(contents) });
  await expect(page.getByText('Documento guardado no cofre.')).toBeVisible();

  const documents = page.getByRole('list', { name: 'Documentos' });
  await documents.getByRole('button', { name: 'Compartilhar' }).click();
  const choice = page.getByRole('group', { name: 'Com quem compartilhar' });
  await expect(choice.getByText(/^Primeiro compartilhamento com esta pessoa\./)).toBeVisible();
  await expect(
    choice.getByText(/^Impressão digital da chave: ([0-9a-f]{4} ){7}[0-9a-f]{4}$/),
  ).toBeVisible();
  await expectAccessible(page);
  await choice.getByLabel(relativeEmail).check();
  await expect(choice.getByText(/^Ao salvar, você e mais 1 pessoa/)).toBeVisible();
  await choice.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Compartilhamento salvo.')).toBeVisible();
  await expect(documents.getByText('Compartilhado com 1 pessoa')).toBeVisible();
  // The pinned key is trusted now, so the first-share note is gone.
  await expect(choice.getByText(/^Primeiro compartilhamento/)).toHaveCount(0);

  await relativePage.reload();
  await relativePage.getByRole('button', { name: 'Abrir o cofre' }).click();
  const shared = relativePage.getByRole('list', { name: 'Documentos' });
  await expect(shared.getByText(fileName)).toBeVisible();
  await expect(shared.getByText('Compartilhado com você')).toBeVisible();
  const download = relativePage.waitForEvent('download');
  await shared.getByRole('button', { name: 'Baixar' }).click();
  expect(await readFile(await (await download).path(), 'utf8')).toBe(contents);

  await choice.getByLabel(relativeEmail).uncheck();
  await expect(choice.getByText(/^Ao salvar, só você/)).toBeVisible();
  await choice.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Compartilhamento salvo.')).toBeVisible();
  await expect(documents.getByText('Compartilhado com 1 pessoa')).toHaveCount(0);

  await relativePage.reload();
  await relativePage.getByRole('button', { name: 'Abrir o cofre' }).click();
  await expect(relativePage.getByText(/^Ainda não há documentos no cofre\./)).toBeVisible();
  await relativeContext.close();
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
  await signOutAndIn(page, email);
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

test('a new recovery kit gives the vault a new secret at its next opening, and the old one stops', async ({
  page,
}) => {
  const problems = watchProblems(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  await virtualAuthenticator(page, credential, { userId });
  await signIn(page, email);
  await keepAccountCode(page, 'Mostrar meu código');
  await expect(page).toHaveURL(`${databaseServer.origin}/`);
  await openVaultPage(page);
  const { secret: old } = await setUp(page);

  // The new account code comes first; the vault's part follows when the vault opens (spec 0003, R6).
  await keepAccountCode(page, 'Gerar um novo código');
  await expect(page).toHaveURL(`${databaseServer.origin}/vault`);
  await expect(page.getByText(/^Seu kit de recuperação mudou/)).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Abrir o cofre' }).click();
  const options = page.waitForRequest(
    (request) =>
      request.url().endsWith('/v1/auth/step-up/options') &&
      request.postData()?.includes('sensitive_settings') === true,
  );
  await page.getByRole('button', { name: 'Criar o novo segredo' }).click();
  expect((await options).postDataJSON()).toMatchObject({
    purpose: 'sensitive_settings',
    target: { action: 'resealVaultRecovery' },
  });
  const secret = await keepSecret(page);
  expect(secret).not.toBe(old);

  await signOutAndIn(page, email);
  await openVaultPage(page);
  await expect(page.getByText(/^Seu kit de recuperação mudou/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir o cofre' }).click();
  const field = page.getByLabel('Segredo de recuperação do cofre');
  await field.fill(old);
  await page.getByRole('button', { name: 'Abrir com o segredo' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Esse segredo não abre o cofre. Confira e tente de novo.',
  );
  await field.fill(secret);
  await page.getByRole('button', { name: 'Abrir com o segredo' }).click();
  await expect(opened(page)).toBeVisible();
  expect(problems).toEqual([]);
});

test('closes after 15 minutes without activity, and activity keeps it open', async ({ page }) => {
  const problems = watchProblems(page);
  await page.clock.install();
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  await virtualAuthenticator(page, credential, { userId });
  await signIn(page, email);
  await openVaultPage(page);
  await setUp(page);

  await page.clock.fastForward('10:00');
  await page.getByRole('heading', { level: 2, name: 'Cofre' }).click();
  await page.clock.fastForward('10:00');
  await expect(opened(page)).toBeVisible();

  await page.clock.fastForward('15:01');
  await expect(page.getByRole('button', { name: 'Abrir o cofre' })).toBeVisible();
  expect(problems).toEqual([]);
});
