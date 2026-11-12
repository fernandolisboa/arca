import { expect, test } from '@playwright/test';
import { addPerson, person, signedIn } from './case-accounts.js';
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

  // The tree is the first layout; the cards and the list show the same people.
  await expect(page.getByRole('button', { name: 'Ver em árvore' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect((await addPerson(page, 'Criança')).getByText('Sem conta')).toBeVisible();

  // The relative joins as the invites screen would add them (spec 0007, R2).
  const joined = await page.request.post(`${databaseServer.origin}/v1/case/members`, {
    headers: { origin: databaseServer.origin },
    data: { accountId: relative, displayName: 'Bruno' },
  });
  expect(joined.status()).toBe(200);
  await page.reload();
  await expect(page.getByText('Bruno entrou no caso.')).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Entram no planejamento' })
      .getByRole('button', { name: 'Criança', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Entendi' }).click();
  await expect((await person(page, 'Bruno')).getByText('Participante do caso')).toBeVisible();

  // A person added once someone else is in the case opens the sharing question, none checked.
  const grandmother = await addPerson(page, 'Avó');
  await expect(grandmother.getByText('Quem pode ver os dados de Avó?')).toBeVisible();
  await expect(grandmother.getByLabel('Bruno').first()).not.toBeChecked();

  const child = await person(page, 'Criança');
  await child.getByRole('button', { name: 'Compartilhamento' }).click();
  await child
    .getByRole('group', { name: /^Dados pessoais/ })
    .getByLabel('Bruno')
    .check();
  await child.getByRole('button', { name: 'Salvar compartilhamento' }).click();
  await expect(
    child.getByText('Quem vê os dados: Bruno. Quem vê as finanças: só você.'),
  ).toBeVisible();

  await child
    .getByLabel('Vínculo', { exact: true })
    .selectOption({ label: 'Criança é filha ou filho de' });
  await child.getByLabel('Com quem').selectOption({ label: 'Ana' });
  await child.getByRole('button', { name: 'Anotar vínculo' }).click();
  await expect(child.getByText('Ana é mãe ou pai de Criança')).toBeVisible();
  // Either end may be the one the viewer keeps: Bruno keeps himself.
  await child.getByLabel('Com quem').selectOption({ label: 'Bruno' });
  await child.getByRole('button', { name: 'Anotar vínculo' }).click();
  await expect(child.getByText('Bruno é mãe ou pai de Criança')).toBeVisible();

  // The cards show the relationships on each person; the choice of layout stays on the device.
  await page.getByRole('button', { name: 'Ver em cartões' }).click();
  await expect(
    page.getByRole('button', { name: 'Criança', exact: true }),
  ).toHaveAccessibleDescription(/^Filha ou filho de Ana · Filha ou filho de Bruno/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ver em cartões' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Ver em árvore' }).click();

  await relativePage.goto(`${databaseServer.origin}/family`);
  await expect(
    (await person(relativePage, 'Criança')).getByText('Você vê os dados.'),
  ).toBeVisible();

  // Revoking shows the relative a notice on their next visit.
  await person(page, 'Criança');
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
  await relativePage.getByRole('tab', { name: 'Caso' }).click();
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
