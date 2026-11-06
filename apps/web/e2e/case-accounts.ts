import { expect, type Page } from '@playwright/test';
import { newCredential, virtualAuthenticator, withoutAutofill } from './passkeys.js';
import { seedAccount } from './postgres/accounts.js';
import { reportViolations } from './problems.js';
import { databaseServer } from './servers.js';

/** A confirmed synthetic account signed in on its own page; answers its account ID. */
export async function signedIn(page: Page) {
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential, undefined, { confirmed: true });
  await virtualAuthenticator(page, credential, { userId });
  await withoutAutofill(page);
  await reportViolations(page);
  await page.goto(`${databaseServer.origin}/sign-in`);
  await page.getByRole('button', { name: 'Entrar com chave de acesso' }).click();
  await expect(page.getByText(`Você entrou como ${email}.`)).toBeVisible();
  return userId;
}

/** A person's card in the family area. */
export const card = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });
