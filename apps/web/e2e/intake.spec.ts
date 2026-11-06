import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signedIn } from './case-accounts.js';
import { resetRateLimits } from './postgres/accounts.js';
import { watchProblems } from './problems.js';
import { databaseServer } from './servers.js';

// The intake screen on the scripted model the e2e server asks for (spec 0008, R4): the writer
// and one child, born in the first year the text states. Synthetic people only.
test.skip(!databaseServer.enabled, 'needs ARCA_E2E_DATABASE and a Postgres (see README)');
test.beforeAll(async () => {
  await resetRateLimits();
});

test('drafts the family from a text, then saves what the member kept', async ({ page }) => {
  const problems = watchProblems(page);
  await signedIn(page);
  await page.goto(`${databaseServer.origin}/family`);
  await page.getByLabel('Seu nome').fill('Ana');
  await page.getByRole('button', { name: 'Começar o caso' }).click();
  await page.getByRole('link', { name: 'Contar com minhas palavras' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Contar com suas palavras' }),
  ).toBeVisible();

  await page
    .getByLabel('Sua família, nas suas palavras')
    .fill('Minha filha nasceu em 2015 e tem cidadania italiana.');
  await page.getByRole('button', { name: 'Montar rascunho' }).click();

  // The writer is the member's own person, with nothing new to say, so only the child is
  // asked about.
  await expect(page.getByRole('region', { name: 'Ana' })).toHaveCount(0);
  const child = page.getByRole('region', { name: 'Pessoa nova (filho ou filha)' });
  await expect(child.getByRole('radio', { name: 'Sim, é alguém novo' })).toBeChecked();
  const save = page.getByRole('button', { name: 'Salvar no caso' });
  await expect(save).toBeDisabled();
  await expect(page.getByText('Dê um nome a cada pessoa nova para salvar.')).toBeVisible();
  await child.getByLabel('Nome', { exact: true }).fill('Bia');

  const bia = page.getByRole('region', { name: 'Bia' });
  await expect(bia.getByRole('checkbox', { name: 'Nascimento de Bia: 2015.' })).toBeChecked();
  await expect(bia.getByRole('checkbox', { name: 'Cidadania de Bia: Itália.' })).toBeChecked();
  const whole = bia.getByRole('checkbox', { name: /todas as cidadanias de Bia/ });
  await expect(whole).not.toBeChecked();
  await whole.check();
  await expect(
    page
      .getByRole('region', { name: 'Vínculos' })
      .getByRole('checkbox', { name: 'Ana é mãe ou pai de Bia.' }),
  ).toBeChecked();
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(violations.map(({ id, nodes }) => [id, nodes.map((node) => node.target)])).toEqual([]);
  await save.click();

  await expect(page.getByRole('heading', { level: 2, name: 'Perguntas guiadas' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver o resumo do caso' }).click();
  await expect(page.getByText(/^Nascimento de Bia: 2015/)).toBeVisible();
  await expect(page.getByText('Cidadania de Bia: Itália.')).toBeVisible();
  await expect(page.getByText(/^Ana é mãe ou pai de Bia/)).toBeVisible();
  expect(problems).toEqual([]);
});
