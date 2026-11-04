import { readFile } from 'node:fs/promises';
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

/** Starts the export, confirms it and returns the downloaded file's name and contents. */
async function exportOnce(page: Page) {
  const stepUp = page.waitForRequest((request) =>
    request.url().endsWith('/v1/auth/step-up/options'),
  );
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar meus dados' }).click();
  await page.getByRole('button', { name: 'Confirmar e baixar' }).click();
  const download = await downloaded;
  await expect(page.getByRole('region', { name: 'Seus dados' }).getByRole('status')).toHaveText(
    'Pronto. O arquivo está nos seus downloads.',
  );
  return {
    stepUp: (await stepUp).postDataJSON() as unknown,
    name: download.suggestedFilename(),
    contents: JSON.parse(await readFile(await download.path(), 'utf8')) as {
      schemaVersion: number;
      tables: { table: string; rows: Record<string, unknown>[] }[];
    },
  };
}

test('downloads the account data after a data_export step-up, each time with its own', async ({
  page,
}) => {
  const problems = watchProblems(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  await virtualAuthenticator(page, credential, { userId });
  await signIn(page, email);
  await page.goto(`${databaseServer.origin}/settings`);
  await expect(page.getByRole('heading', { level: 3, name: 'Seus dados' })).toBeVisible();

  const first = await exportOnce(page);
  expect(first.stepUp).toMatchObject({
    purpose: 'data_export',
    target: { action: 'exportAccountData', targets: [] },
  });
  expect(first.name).toMatch(/^arca-meus-dados-\d{4}-\d{2}-\d{2}\.json$/);
  expect(first.contents.schemaVersion).toBe(1);
  const account = first.contents.tables.find(({ table }) => table === 'auth.user');
  expect(account?.rows).toEqual([expect.objectContaining({ email })]);

  const second = await exportOnce(page);
  expect(second.stepUp).toMatchObject({ purpose: 'data_export' });
  expect(problems).toEqual([]);
});

test('offers no export without a session', async ({ page }) => {
  await page.goto(`${databaseServer.origin}/settings`);
  await expect(page.getByRole('heading', { level: 2, name: 'Configurações' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Baixar meus dados' })).toHaveCount(0);
});
