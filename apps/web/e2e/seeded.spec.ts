import { expect, test } from '@playwright/test';
import { seededCredential, virtualAuthenticator, withoutAutofill } from './passkeys.js';
import { resetRateLimits, runSeed } from './postgres/accounts.js';
import { reportViolations, watchProblems } from './problems.js';
import { databaseServer } from './servers.js';

test.skip(!databaseServer.enabled, 'needs ARCA_E2E_DATABASE and a Postgres (see README)');

test.beforeEach(async ({ page }) => {
  await reportViolations(page);
});

test('a seeded account signs in with its passkey (spec 0004, R2)', async ({ page }, testInfo) => {
  // One project only: the passkey's counter is shared, and a second fresh authenticator would
  // repeat it.
  test.skip(testInfo.project.name !== 'desktop', 'runs once, on the desktop project');
  // The enrollment tests empty the accounts after CI seeds them, so the seed runs again here.
  const [account] = await runSeed();
  if (account === undefined) throw new Error('the seed lists no account');
  await resetRateLimits();
  const problems = watchProblems(page);
  await virtualAuthenticator(page, seededCredential(account.passkey.label), {
    userId: account.id,
  });
  await withoutAutofill(page);

  await page.goto(`${databaseServer.origin}/sign-in`);
  await page.getByRole('button', { name: 'Entrar com chave de acesso' }).click();
  await expect(page.getByText(`Você entrou como ${account.email}.`)).toBeVisible();
  expect(problems).toEqual([]);
});
