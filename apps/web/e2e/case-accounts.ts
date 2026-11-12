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

/** Opens a person in the family area and answers the panel that shows them. */
export async function person(page: Page, name: string) {
  // On a phone the panel covers the people; going back shows them again.
  const back = page.getByRole('button', { name: 'Voltar para a família' });
  if (await back.isVisible()) await back.click();
  await page.getByRole('button', { name, exact: true }).click();
  return panel(page, name);
}

/** The family area's panel while it shows `name`. */
export const panel = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

/** Adds a person to the case from the family area, in the planning. */
export async function addPerson(page: Page, name: string) {
  await page.getByRole('button', { name: 'Adicionar pessoa' }).click();
  await page.getByLabel('Nome', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Salvar pessoa' }).click();
  return panel(page, name);
}

/** A synthetic family: Ana, who answers, and her child. */
export async function family(page: Page) {
  await page.goto(`${databaseServer.origin}/family`);
  await page.getByLabel('Seu nome').fill('Ana');
  await page.getByRole('button', { name: 'Começar o caso' }).click();
  const child = await addPerson(page, 'Criança');
  await child
    .getByLabel('Vínculo', { exact: true })
    .selectOption({ label: 'Criança é filha ou filho de' });
  await child.getByLabel('Com quem').selectOption({ label: 'Ana' });
  await child.getByRole('button', { name: 'Anotar vínculo' }).click();
  await expect(child.getByText('Ana é mãe ou pai de Criança')).toBeVisible();
}
