import { expect, test } from '@playwright/test';
import { card, signedIn } from './case-accounts.js';
import { linkAccounts, resetRateLimits } from './postgres/accounts.js';
import { watchProblems } from './problems.js';
import { databaseServer } from './servers.js';

test.skip(!databaseServer.enabled, 'needs ARCA_E2E_DATABASE and a Postgres (see README)');
test.beforeAll(async () => {
  await resetRateLimits();
});

test('starts a case, adds people, shares a child with a member and tells them', async ({
  page,
  browser,
}) => {
  const problems = watchProblems(page);
  const owner = await signedIn(page);
  const relativeContext = await browser.newContext();
  const relativePage = await relativeContext.newPage();
  const relative = await signedIn(relativePage);
  await linkAccounts(owner, relative);

  await page.goto(`${databaseServer.origin}/family`);
  await expect(page.getByRole('heading', { level: 2, name: 'Área da família' })).toBeVisible();
  await page.getByLabel('Seu nome').fill('Ana');
  await page.getByRole('button', { name: 'Começar o caso' }).click();
  await expect(page.getByText('Ana (você)')).toBeVisible();

  await page.getByLabel('Nome', { exact: true }).fill('Criança');
  await page.getByRole('button', { name: 'Adicionar pessoa' }).click();
  await expect(card(page, 'Criança').getByText('Sem conta')).toBeVisible();

  // The relative joins as the invites screen would add them (spec 0007, R2).
  const joined = await page.request.post(`${databaseServer.origin}/v1/case/members`, {
    headers: { origin: databaseServer.origin },
    data: { accountId: relative, displayName: 'Bruno' },
  });
  expect(joined.status()).toBe(200);
  await page.reload();
  await expect(page.getByText('Bruno entrou no caso.')).toBeVisible();
  await page.getByRole('button', { name: 'Entendi' }).click();
  await expect(card(page, 'Bruno').getByText('Participante do caso')).toBeVisible();

  // A person added once someone else is in the case opens the sharing question, none checked.
  await page.getByLabel('Nome', { exact: true }).fill('Avó');
  await page.getByRole('button', { name: 'Adicionar pessoa' }).click();
  await expect(card(page, 'Avó').getByText('Quem pode ver os dados de Avó?')).toBeVisible();
  await expect(card(page, 'Avó').getByLabel('Bruno').first()).not.toBeChecked();

  const child = card(page, 'Criança');
  await child.getByRole('button', { name: 'Compartilhamento' }).click();
  await child
    .getByRole('group', { name: /^Dados pessoais/ })
    .getByLabel('Bruno')
    .check();
  await child.getByRole('button', { name: 'Salvar compartilhamento' }).click();
  await expect(
    child.getByText('Quem vê os dados: Bruno. Quem vê as finanças: só você.'),
  ).toBeVisible();

  await page.getByLabel('Com quem').selectOption({ label: 'Criança' });
  await page.getByRole('button', { name: 'Anotar vínculo' }).click();
  await expect(page.getByText('Ana é mãe ou pai de Criança')).toBeVisible();
  await expect(child.getByText('Filha ou filho de Ana')).toBeVisible();
  // Either end may be the one the viewer keeps.
  await page.getByLabel('Pessoa', { exact: true }).selectOption({ label: 'Bruno' });
  await page.getByLabel('Com quem').selectOption({ label: 'Criança' });
  await page.getByRole('button', { name: 'Anotar vínculo' }).click();
  await expect(page.getByText('Bruno é mãe ou pai de Criança')).toBeVisible();

  await relativePage.goto(`${databaseServer.origin}/family`);
  await expect(card(relativePage, 'Criança').getByText('Você vê os dados.')).toBeVisible();

  // Revoking shows the relative a notice on their next visit.
  await child.getByRole('button', { name: 'Compartilhamento' }).click();
  await child
    .getByRole('group', { name: /^Dados pessoais/ })
    .getByLabel('Bruno')
    .uncheck();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/v1/case/people/shares') && response.ok(),
  );
  await child.getByRole('button', { name: 'Salvar compartilhamento' }).click();
  await saved;
  await relativePage.reload();
  await expect(relativePage.getByText('Você não vê mais os dados de Criança.')).toBeVisible();

  // Leaving takes a step-up, and the relative's case is gone for them.
  const stepUp = relativePage.waitForRequest((request) =>
    request.url().endsWith('/v1/auth/step-up/options'),
  );
  await relativePage.getByRole('button', { name: 'Sair do caso' }).click();
  await relativePage.getByRole('button', { name: 'Sim, sair do caso' }).click();
  await expect(relativePage.getByRole('button', { name: 'Começar o caso' })).toBeVisible();
  expect((await stepUp).postDataJSON()).toMatchObject({
    purpose: 'sensitive_settings',
    target: { action: 'leaveCase', targets: [] },
  });
  await relativeContext.close();
  expect(problems).toEqual([]);
});
