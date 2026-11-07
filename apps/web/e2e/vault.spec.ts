import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';
import {
  createdPrfCredential,
  newCredential,
  virtualAuthenticator,
  withoutAutofill,
} from './passkeys.js';
import {
  addRecipientRow,
  linkAccounts,
  recordEvent,
  resetRateLimits,
  restoreSharingState,
  seedAccount,
  seedPasskey,
  sharingStateOf,
} from './postgres/accounts.js';
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
  await page.getByRole('link', { name: 'Abrir o cofre' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Cofre' })).toBeVisible();
}

async function expectAccessible(page: Page) {
  expect(await new AxeBuilder({ page }).analyze().then(({ violations }) => violations)).toEqual([]);
}

const opened = (page: Page) => page.getByText(/^O cofre está aberto neste dispositivo\./);

/** Each recovery envelope is an scrypt passphrase file: seconds of work on a busy machine. */
const scrypt = { timeout: 20_000 };

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
  await expect(sheet).toBeVisible(scrypt);
  const secret = (await sheet.locator('p').nth(1).innerText()).trim();
  expect(secret).toMatch(/^[0-9A-Z]{4}( [0-9A-Z]{1,4}){6}$/);
  await expectAccessible(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await sheet.getByRole('button', { name: 'Copiar o segredo' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);
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
  const replace = await page.request.post(`${databaseServer.origin}/v1/vault/documents/replace`, {
    headers: { origin: databaseServer.origin },
    data: {
      recipients: [],
      documents: [{ documentId, size: 64, sha256: 'A'.repeat(43), label: 'AAAA' }],
    },
  });
  expect(replace.status()).toBe(403);
  expect(await replace.json()).toEqual({ error: { code: 'step_up_required' } });
  await page.reload();
  await page.getByRole('button', { name: 'Abrir o cofre' }).click();
  await expect(documents.getByText(fileName)).toBeVisible();
  const unchanged = page.waitForEvent('download');
  await documents.getByRole('button', { name: 'Baixar' }).click();
  expect(await readFile(await (await unchanged).path(), 'utf8')).toBe(contents);

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

/** Adds a synthetic text file to the open vault. */
async function addFile(page: Page, name: string, contents: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Adicionar documento' }).click();
  await (await chooser).setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(contents) });
  await expect(page.getByText('Documento guardado no cofre.')).toBeVisible();
}

async function downloaded(page: Page, row: ReturnType<Page['getByRole']>) {
  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Baixar' }).click();
  return readFile(await (await download).path(), 'utf8');
}

test('never encrypts to a recipient the server added, and asks before using a restored older list', async ({
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
  const fileName = 'visto-exemplo.txt';
  await addFile(page, fileName, 'synthetic visa');
  const documents = page.getByRole('list', { name: 'Documentos' });
  const choice = page.getByRole('group', { name: 'Com quem compartilhar' });
  await documents.getByRole('button', { name: 'Compartilhar' }).click();
  await choice.getByLabel(relativeEmail).check();
  await choice.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Compartilhamento salvo.')).toBeVisible();
  const sharedState = await sharingStateOf(owner.userId);
  await choice.getByLabel(relativeEmail).uncheck();
  await choice.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Compartilhamento salvo.')).toBeVisible();
  await expect(documents.getByText('Compartilhado com 1 pessoa')).toHaveCount(0);
  await expect
    .poll(async () => (await sharingStateOf(owner.userId)).version)
    .toBeGreaterThan(sharedState.version);

  // A recipient row the owner's list does not name is called out, and its box starts clear.
  const documentId = await addRecipientRow(owner.userId, relative.userId);
  await page.reload();
  await page.getByRole('button', { name: 'Abrir o cofre' }).click();
  await documents.getByRole('button', { name: 'Compartilhar' }).click();
  await expect(choice.getByText(/^O servidor diz que 1 pessoa tem acesso/)).toBeVisible();
  await expect(choice.getByLabel(relativeEmail)).not.toBeChecked();
  await expectAccessible(page);
  // The relative is listed by the server, but nothing was encrypted to them.
  await relativePage.reload();
  await relativePage.getByRole('button', { name: 'Abrir o cofre' }).click();
  await expect(
    relativePage.getByText(/^Alguns documentos não abriram com a chave atual do cofre\./),
  ).toBeVisible();
  await choice.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Compartilhamento salvo.')).toBeVisible();
  await relativePage.reload();
  await relativePage.getByRole('button', { name: 'Abrir o cofre' }).click();
  await expect(relativePage.getByText(/^Ainda não há documentos no cofre\./)).toBeVisible();

  // A restored older list waits for the owner, who sees what it shares first.
  const highest = (await sharingStateOf(owner.userId)).version;
  await restoreSharingState(owner.userId, sharedState);
  await page.reload();
  await page.getByRole('button', { name: 'Abrir o cofre' }).click();
  await documents.getByRole('button', { name: 'Compartilhar' }).click();
  await expect(
    page.getByText(/^A lista de compartilhamento guardada no servidor é mais antiga/),
  ).toBeVisible();
  await expect(
    page
      .getByRole('list', { name: 'Compartilhamentos nesta lista' })
      .getByText(`${fileName}: ${relativeEmail}`),
  ).toBeVisible();
  await expect(choice).toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Conferi, pode usar esta lista' }).click();
  await expect(page.getByText('Lista de compartilhamento confirmada.')).toBeVisible();
  // Confirming tags it above the version stored and the one this device saw.
  expect((await sharingStateOf(owner.userId)).version).toBeGreaterThan(highest);

  // No document opens in a new session until its own vault_unlock step-up (spec 0005, R2).
  await signOutAndIn(page, ownerEmail);
  const refused = await page.request.post(`${databaseServer.origin}/v1/vault/documents/download`, {
    headers: { origin: databaseServer.origin },
    data: { documentId },
  });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ error: { code: 'step_up_required' } });
  await relativeContext.close();
  expect(problems).toEqual([]);
});

test('rotates the vault key: a new kit, the old key still opens shared documents, and each owner moves to the new one', async ({
  page,
  browser,
}) => {
  // Three devices, two rotations of their documents and several step-ups.
  test.setTimeout(90_000);
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
  await addFile(relativePage, 'rg-exemplo.txt', 'synthetic identity card');

  // A WebAuthn prompt waits for its page to have focus, so each switch brings it to the front.
  await page.bringToFront();
  await signIn(page, ownerEmail);
  await openVaultPage(page);
  await setUp(page);
  await addFile(page, 'passaporte-exemplo.txt', 'synthetic passport scan');
  const documents = page.getByRole('list', { name: 'Documentos' });
  await documents.getByRole('button', { name: 'Compartilhar' }).click();
  const choice = page.getByRole('group', { name: 'Com quem compartilhar' });
  await choice.getByLabel(relativeEmail).check();
  await choice.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Compartilhamento salvo.')).toBeVisible();

  // The relative rotates: a new kit straight away, and the replaced key stays open here.
  await relativePage.bringToFront();
  await relativePage.reload();
  await relativePage.getByRole('button', { name: 'Abrir o cofre' }).click();
  await relativePage.getByRole('button', { name: 'Trocar a chave do cofre' }).click();
  const secret = await keepSecret(relativePage);
  const relativeDocuments = relativePage.getByRole('list', { name: 'Documentos' });
  const sharedRow = relativeDocuments.getByRole('listitem').filter({ hasText: 'passaporte' });
  expect(await downloaded(relativePage, sharedRow)).toBe('synthetic passport scan');
  await expect(
    relativePage.getByText('1 documento seu ainda usa a chave antiga do cofre.'),
  ).toBeVisible();
  await expectAccessible(relativePage);

  // The relative moves their own document to the new key.
  await relativePage.getByRole('button', { name: 'Passar para a chave nova' }).click();
  await expect(
    relativePage.getByText('Pronto, seus documentos já usam a chave nova.'),
  ).toBeVisible();

  // Another device without PRF: the new kit opens the vault and, once more, the replaced key,
  // for the document its owner has not moved yet. (One credential on two authenticators: this
  // one's counter starts higher, so the first device signs nothing after it.)
  const deviceContext = await browser.newContext();
  const devicePage = await deviceContext.newPage();
  await devicePage.bringToFront();
  await withoutAutofill(devicePage);
  await virtualAuthenticator(devicePage, relative.credential, {
    userId: relative.userId,
    signCount: 1000,
  });
  await signIn(devicePage, relativeEmail);
  await openVaultPage(devicePage);
  await devicePage.getByRole('button', { name: 'Abrir o cofre' }).click();
  await devicePage.getByLabel('Segredo de recuperação do cofre').fill(secret);
  await devicePage.getByRole('button', { name: 'Abrir com o segredo' }).click();
  await expect(opened(devicePage)).toBeVisible(scrypt);
  await devicePage.getByRole('button', { name: 'Abrir com a chave antiga' }).click();
  await devicePage.getByLabel('Segredo de recuperação do cofre').fill(secret);
  await devicePage.getByRole('button', { name: 'Abrir a chave antiga' }).click();
  await expect(devicePage.getByText('A chave antiga está aberta neste dispositivo.')).toBeVisible(
    scrypt,
  );
  const deviceDocuments = devicePage.getByRole('list', { name: 'Documentos' });
  expect(
    await downloaded(
      devicePage,
      deviceDocuments.getByRole('listitem').filter({ hasText: 'passaporte' }),
    ),
  ).toBe('synthetic passport scan');

  // The owner accepts the new key and saves the share again.
  await page.bringToFront();
  await page.reload();
  await page.getByRole('button', { name: 'Abrir o cofre' }).click();
  await documents.getByRole('button', { name: 'Compartilhar' }).click();
  await expect(choice.getByText(/^A chave do cofre desta pessoa mudou\./)).toBeVisible();
  await expect(choice.getByText(/^Impressão digital da chave nova: /)).toBeVisible();
  await choice.getByRole('button', { name: 'Aceitar a chave nova' }).click();
  await choice.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Compartilhamento salvo.')).toBeVisible();

  // Now the new key alone opens both, on the device that keeps it wrapped.
  await devicePage.bringToFront();
  await devicePage.reload();
  await devicePage.getByRole('button', { name: 'Abrir o cofre' }).click();
  await expect(opened(devicePage)).toBeVisible();
  await expect(deviceDocuments.getByText('rg-exemplo.txt')).toBeVisible();
  await expect(deviceDocuments.getByText('passaporte-exemplo.txt')).toBeVisible();
  await expect(devicePage.getByRole('button', { name: 'Abrir com a chave antiga' })).toHaveCount(0);
  await deviceContext.close();
  await relativeContext.close();
  expect(problems).toEqual([]);
});

test('finishes a rotation the server stored when its answer never arrived', async ({ page }) => {
  const problems = watchProblems(page);
  const { credential, userId } = await createdPrfCredential(page);
  const { email } = await seedAccount(credential, userId);
  await signIn(page, email);
  await openVaultPage(page);
  await setUp(page);

  // The rotation reaches the server and is stored; the answer is lost on the way back.
  let lost = false;
  await page.route('**/v1/vault/rotate', async (route) => {
    await route.fetch();
    lost = true;
    await route.abort('connectionreset');
  });
  await page.getByRole('button', { name: 'Trocar a chave do cofre' }).click();
  const secret = await keepSecret(page);
  expect(lost).toBe(true);

  await page.getByRole('button', { name: 'Fechar o cofre' }).click();
  await page.getByRole('button', { name: 'Abrir o cofre' }).click();
  await expect(opened(page)).toBeVisible();
  expect(secret).not.toBe('');
  // Only the cut connection itself, which the browser logs without its URL.
  expect(
    problems.filter((problem) => !problem.startsWith('Failed to load resource: net::')),
  ).toEqual([]);
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

const rotationDue = (page: Page) => page.getByText(/^Uma chave de acesso foi removida/);

/** Rotates from the open vault and keeps the new kit, which leaves nothing due. */
async function rotate(page: Page) {
  const options = page.waitForRequest(
    (request) =>
      request.url().endsWith('/v1/auth/step-up/options') &&
      request.postData()?.includes('rotateVaultIdentity') === true,
  );
  await page.getByRole('button', { name: 'Trocar a chave do cofre' }).click();
  await options;
  return keepSecret(page);
}

test('offers a rotation once a passkey that could open the vault is removed', async ({ page }) => {
  const problems = watchProblems(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  await seedPasskey(userId, newCredential());
  await virtualAuthenticator(page, credential, { userId });
  await signIn(page, email);
  await openVaultPage(page);
  await setUp(page);
  await expect(rotationDue(page)).toHaveCount(0);

  await page.goto(`${databaseServer.origin}/devices`);
  await page
    .getByRole('listitem')
    .filter({ hasNot: page.getByText('Você entrou neste dispositivo com esta chave.') })
    .getByRole('button', { name: 'Remover esta chave' })
    .click();
  await expect(page.getByRole('status').first()).toHaveText(/^Chave removida\./);
  await expect(
    page.getByText(/^A chave de acesso que você removeu pode ter aberto o seu cofre\./),
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Trocar a chave do cofre' }).click();

  // The identity this device keeps wrapped opens the vault; the rotation comes before the documents.
  await page.getByRole('button', { name: 'Abrir o cofre' }).click();
  await expect(rotationDue(page)).toBeVisible();
  await expectAccessible(page);
  await rotate(page);
  await expect(rotationDue(page)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('after an account recovery, offers a rotation in place of a new secret alone', async ({
  page,
}) => {
  const problems = watchProblems(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  await virtualAuthenticator(page, credential, { userId });
  await signIn(page, email);
  await openVaultPage(page);
  const { secret: old } = await setUp(page);
  await recordEvent(userId, 'recovery_completed');

  await page.reload();
  await expect(page.getByText(/^Seu kit de recuperação mudou/)).toBeVisible();
  await page.getByRole('button', { name: 'Abrir o cofre' }).click();
  await expect(page.getByText(/^Como a conta foi recuperada/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Só criar o novo segredo' })).toBeVisible();
  await expectAccessible(page);
  const secret = await rotate(page);
  expect(secret).not.toBe(old);
  await expect(rotationDue(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Criar o novo segredo' })).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('after a rotation and a reload, opens the old key so a new kit can re-seal it', async ({
  page,
}) => {
  const problems = watchProblems(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  await virtualAuthenticator(page, credential, { userId });
  await signIn(page, email);
  await keepAccountCode(page, 'Mostrar meu código');
  await openVaultPage(page);
  await setUp(page);
  const rotated = await rotate(page);

  // A new kit after a full page load: the replaced identity is no longer held in memory.
  await keepAccountCode(page, 'Gerar um novo código');
  await expect(page).toHaveURL(`${databaseServer.origin}/vault`);
  await page.getByRole('button', { name: 'Abrir o cofre' }).click();
  await page.getByRole('button', { name: 'Criar o novo segredo' }).click();
  await expect(page.getByText(/^Antes, abra neste dispositivo a chave antiga/)).toBeVisible();
  await page.getByRole('button', { name: 'Abrir com a chave antiga' }).click();
  await page.getByLabel('Segredo de recuperação do cofre').fill(rotated);
  await page.getByRole('button', { name: 'Abrir a chave antiga' }).click();
  await expect(page.getByText('A chave antiga está aberta neste dispositivo.')).toBeVisible(scrypt);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Criar o novo segredo' }).click();
  expect(await keepSecret(page)).not.toBe(rotated);
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
