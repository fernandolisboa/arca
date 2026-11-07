import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  deleteAccounts,
  enrolledAccount,
  latestEmailTo,
  resetEnrollment,
} from './postgres/accounts.js';
import { reportViolations, watchProblems } from './problems.js';
import { databaseServer, e2eEnrollmentCode } from './servers.js';

test.skip(!databaseServer.enabled, 'needs ARCA_E2E_DATABASE and a Postgres (see README)');
// One owner per database: the steps build on each other.
test.describe.configure({ mode: 'serial' });

const owner = 'e2e-owner@example.com';
const groupedCode = /^(?:[0-9A-HJKMNP-TV-Z]{4} ){6}[0-9A-HJKMNP-TV-Z]{2}$/;

test.beforeAll(async () => {
  await resetEnrollment();
});

test.beforeEach(async ({ page }) => {
  await reportViolations(page);
});

/** Failed API calls the screens word themselves, and so expect. */
function unexpected(problems: readonly string[]): string[] {
  return problems.filter((problem) => !/^Failed to load resource: .* (403|404)/.test(problem));
}

async function scan(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  return violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }));
}

/** Chromium's virtual platform authenticator, empty, with user verification and PRF. */
async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      hasPrf: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

async function requestLink(page: Page, code: string) {
  await page.goto(`${databaseServer.origin}/enroll`);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Criar a primeira conta' }),
  ).toBeVisible();
  await page.getByLabel('Código de cadastro').fill(code);
  await page.getByLabel('Email').fill(owner);
  await page.getByRole('button', { name: 'Enviar o link' }).click();
}

test('creates the first account from the emailed link, and shows its recovery kit once', async ({
  page,
  browser,
}) => {
  const problems = watchProblems(page);
  await virtualAuthenticator(page);

  await requestLink(page, e2eEnrollmentCode);
  await expect(page.getByRole('status')).toHaveText(/^Pronto\. Abra o email/);
  expect(await scan(page)).toEqual([]);
  const link = (await latestEmailTo(owner))?.match(/http:\/\/\S+\/enroll#[A-Za-z0-9_-]{43}/)?.[0];
  expect(link).toBeDefined();

  // The token leaves the address bar as soon as the page reads it.
  await page.goto(String(link));
  await expect(
    page.getByRole('heading', { level: 2, name: 'Criar sua chave de acesso' }),
  ).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  expect(await scan(page)).toEqual([]);

  await page.getByLabel('Código de cadastro').fill('not-the-code');
  await page.getByRole('button', { name: 'Criar chave de acesso' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Esse código não confere. Confira e tente de novo.',
  );

  await page.getByLabel('Código de cadastro').fill(e2eEnrollmentCode);
  await page.getByRole('button', { name: 'Criar chave de acesso' }).click();
  await expect(page).toHaveURL(`${databaseServer.origin}/recovery-kit`);

  // Until the kit is saved, the home page says so.
  await page.goto(`${databaseServer.origin}/`);
  await expect(page.getByText(`Você entrou como ${owner}.`)).toBeVisible();
  await page.getByRole('link', { name: 'Guardar o kit agora' }).click();
  await page.getByRole('button', { name: 'Mostrar meu código' }).click();
  const code = page.getByRole('group', { name: 'Código de recuperação' }).getByText(groupedCode);
  await expect(code).toHaveText(groupedCode);
  const first = await code.textContent();
  expect(await scan(page)).toEqual([]);

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copiar o código' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copiado' })).toBeAttached();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);

  await page.getByRole('button', { name: 'Baixar como arquivo de texto' }).click();
  await expect(page.getByText(/^Um arquivo de texto pode parar/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar mesmo assim' }).click();
  expect((await download).suggestedFilename()).toBe('arca-codigo-de-recuperacao.txt');

  const finish = page.getByRole('button', { name: 'Continuar' });
  await expect(finish).toBeDisabled();
  await page.getByLabel('Guardei o código num lugar seguro').check();
  await finish.click();
  await expect(page).toHaveURL(`${databaseServer.origin}/`);
  await expect(page.getByText(`Você entrou como ${owner}.`)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Guardar o kit agora' })).toHaveCount(0);

  expect(await enrolledAccount(owner)).toEqual([
    { confirmed: true, prf_enabled: true, kit_saved: true },
  ]);

  // A saved code is never shown again; a new one takes a step-up with the passkey (spec 0003, R5).
  const options = page.waitForRequest((request) =>
    request.url().endsWith('/v1/auth/step-up/options'),
  );
  await page.goto(`${databaseServer.origin}/recovery-kit`);
  await expect(page.getByText(/^Seu código de recuperação está guardado/)).toBeVisible();
  await page.getByRole('button', { name: 'Gerar um novo código' }).click();
  await expect(code).toHaveText(groupedCode);
  expect(await code.textContent()).not.toBe(first);
  expect((await options).postDataJSON()).toMatchObject({
    purpose: 'sensitive_settings',
    target: { action: 'regenerateRecoveryKit', targets: [] },
  });
  expect(await enrolledAccount(owner)).toEqual([
    { confirmed: true, prf_enabled: true, kit_saved: false },
  ]);

  // The owner invites someone, who registers unconfirmed until the owner confirms them (R2).
  const invitee = 'e2e-invitee@example.org';
  await page.goto(`${databaseServer.origin}/invites`);
  await page.getByLabel('Email de quem você quer convidar').fill(invitee);
  await page.getByRole('button', { name: 'Enviar convite' }).click();
  await expect(page.getByText(`Convite enviado para ${invitee}.`)).toBeVisible();
  await expect(page.getByText(/^Esperando a pessoa aceitar, até /)).toBeVisible();
  expect(await scan(page)).toEqual([]);
  const inviteLink = (await latestEmailTo(invitee))?.match(
    /http:\/\/\S+\/invite#[A-Za-z0-9_-]{43}/,
  )?.[0];
  expect(inviteLink).toBeDefined();

  // A browser signed in to another account offers to sign out instead of creating a passkey.
  await page.goto(String(inviteLink));
  await expect(page.getByText(`${owner} convidou você para usar o Arca.`)).toBeVisible();
  await expect(
    page.getByText(`Este navegador já entrou no Arca como ${owner}.`, { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sair desta conta' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Criar chave de acesso' })).toHaveCount(0);
  expect(await scan(page)).toEqual([]);

  // Invitees mostly open the link on a phone.
  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const guest = await guestContext.newPage();
  const guestProblems = watchProblems(guest);
  await reportViolations(guest);
  await virtualAuthenticator(guest);
  await guest.goto(String(inviteLink));
  await expect(guest.getByText(`${owner} convidou você para usar o Arca.`)).toBeVisible();
  await expect.poll(() => new URL(guest.url()).hash).toBe('');
  expect(await scan(guest)).toEqual([]);
  await guest.getByRole('button', { name: 'Criar chave de acesso' }).click();
  await expect(guest).toHaveURL(`${databaseServer.origin}/recovery-kit`);
  await guest.getByRole('button', { name: 'Mostrar meu código' }).click();
  await expect(
    guest.getByRole('group', { name: 'Código de recuperação' }).getByText(groupedCode),
  ).toHaveText(groupedCode);
  await guest.goto(`${databaseServer.origin}/`);
  await expect(guest.getByText(`Você entrou como ${invitee}.`)).toBeVisible();
  await expect(guest.getByText(/^Sua conta está aguardando a confirmação/)).toBeVisible();

  await page.goto(`${databaseServer.origin}/invites`);
  await expect(page.getByText(`Confirme a conta de ${invitee}`)).toBeVisible();
  expect(await scan(page)).toEqual([]);
  const confirm = page.waitForRequest((request) =>
    request.url().endsWith('/v1/auth/step-up/options'),
  );
  await page.getByRole('button', { name: 'Confirmar conta' }).click();
  await expect(page.getByText(`Conta de ${invitee} confirmada.`)).toBeVisible();
  await expect(page.getByText('Confirmado', { exact: true })).toBeVisible();
  expect((await confirm).postDataJSON()).toMatchObject({
    purpose: 'sensitive_settings',
    target: { action: 'confirmInvite' },
  });

  // With a case of their own, the owner then adds the confirmed account to it (spec 0007, R2).
  const created = await page.request.post(`${databaseServer.origin}/v1/case`, {
    headers: { origin: databaseServer.origin },
    data: { displayName: 'Titular' },
  });
  expect(created.status()).toBe(200);
  await page.reload();
  await page.getByLabel('Nome dessa pessoa').fill('Pessoa convidada');
  await page.getByRole('button', { name: 'Adicionar ao caso' }).click();
  await expect(page.getByText(`${invitee} participa do caso.`)).toBeVisible();
  expect(await scan(page)).toEqual([]);

  await guest.reload();
  await expect(guest.getByRole('link', { name: 'Convidar alguém' })).toBeVisible();
  await guestContext.close();
  expect(unexpected(guestProblems)).toEqual([]);

  // Signing out from an invite's link turns the notice into the passkey prompt.
  const signOutInvitee = 'e2e-sign-out@example.org';
  await page.getByLabel('Email de quem você quer convidar').fill(signOutInvitee);
  await page.getByRole('button', { name: 'Enviar convite' }).click();
  await expect(page.getByText(`Convite enviado para ${signOutInvitee}.`)).toBeVisible();
  const signOutLink = (await latestEmailTo(signOutInvitee))?.match(
    /http:\/\/\S+\/invite#[A-Za-z0-9_-]{43}/,
  )?.[0];
  expect(signOutLink).toBeDefined();
  await page.goto(String(signOutLink));
  await page.getByRole('button', { name: 'Sair desta conta' }).click();
  await expect(page.getByRole('button', { name: 'Criar chave de acesso' })).toBeEnabled();
  await page.goto(`${databaseServer.origin}/`);
  await expect(page.getByRole('link', { name: 'Entrar' })).toBeVisible();
  expect(unexpected(problems)).toEqual([]);
});

test('closes owner enrollment once the first account exists, even after it is erased', async ({
  page,
}) => {
  await requestLink(page, e2eEnrollmentCode);
  const closed = 'Esse código não serve. Ou ele está errado, ou o Arca já tem uma conta.';
  await expect(page.getByRole('status')).toHaveText(closed);
  await deleteAccounts();
  await requestLink(page, e2eEnrollmentCode);
  await expect(page.getByRole('status')).toHaveText(closed);
});

test('says an expired link is expired, and offers a new one', async ({ page }) => {
  await page.goto(`${databaseServer.origin}/enroll#${'A'.repeat(43)}`);
  await page.getByLabel('Código de cadastro').fill(e2eEnrollmentCode);
  await page.getByRole('button', { name: 'Criar chave de acesso' }).click();
  await expect(page.getByRole('status')).toHaveText('Este link não vale mais. Peça um novo.');
  await page.getByRole('button', { name: 'Pedir um novo link' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Criar a primeira conta' }),
  ).toBeVisible();
});
