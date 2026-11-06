import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { family, signedIn } from './case-accounts.js';
import { resetRateLimits } from './postgres/accounts.js';
import { watchProblems } from './problems.js';
import { databaseServer } from './servers.js';

test.skip(!databaseServer.enabled, 'needs ARCA_E2E_DATABASE and a Postgres (see README)');
test.beforeAll(async () => {
  await resetRateLimits();
});

const step = (page: Page, name: string) => page.getByRole('form', { name });
const group = (scope: Locator, name: string) => scope.getByRole('group', { name });
const radio = (scope: Locator, question: string, answer: string) =>
  group(scope, question).getByRole('radio', { name: answer, exact: true }).check();

test('fills a family in step by step, with "Não sei", and reads it back', async ({ page }) => {
  const problems = watchProblems(page);
  await signedIn(page);
  await family(page);
  await page.getByRole('link', { name: 'Responder às perguntas guiadas' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Perguntas guiadas' })).toBeVisible();

  const basics = step(page, 'Dados básicos');
  const born = group(basics, 'Quando Ana nasceu?');
  // A half-typed year never goes as "Não sei": the browser keeps the step from being sent.
  await born.getByLabel('Mês').selectOption({ label: 'abril' });
  await basics.getByRole('button', { name: 'Salvar e continuar' }).click();
  await expect(born.getByLabel('Ano')).toHaveJSProperty('validity.valueMissing', true);
  await born.getByLabel('Ano').fill('198');
  await basics.getByRole('button', { name: 'Salvar e continuar' }).click();
  await expect(born.getByLabel('Ano')).toHaveJSProperty('validity.patternMismatch', true);
  await expect(step(page, 'Dados básicos')).toBeVisible();
  await born.getByLabel('Ano').fill('1985');
  await radio(basics, 'Quais cidadanias Ana tem ou já teve?', 'Sim');
  await basics.getByLabel('País', { exact: true }).selectOption({ label: 'Brasil' });
  await basics.getByLabel('Como conseguiu').selectOption({ label: 'Nascimento' });
  await basics.getByLabel('Em que país Ana mora hoje?').selectOption({ label: 'Brasil' });
  await basics.getByRole('button', { name: 'Salvar e continuar' }).click();

  const studies = step(page, 'Estudos e idiomas');
  await studies
    .getByLabel('Até onde Ana estudou?')
    .selectOption({ label: 'Graduação: bacharelado, licenciatura ou tecnólogo' });
  await radio(studies, 'Ana está estudando agora?', 'Não');
  await radio(studies, 'Que idiomas Ana fala?', 'Sim');
  await studies.getByLabel('Idioma').selectOption({ label: 'português' });
  await studies.getByLabel('Nível').selectOption({ label: 'Língua materna' });
  await studies.getByRole('button', { name: 'Salvar e continuar' }).click();

  const work = step(page, 'Trabalho');
  await radio(work, 'Ana tem oferta de emprego em outro país?', 'Nenhum');
  await work.getByRole('button', { name: 'Salvar e continuar' }).click();

  const finances = step(page, 'Finanças');
  await radio(finances, 'Quanto Ana recebe por mês?', 'Sim');
  const incomes = finances.getByRole('listitem').filter({ has: page.getByLabel('Valor') });
  await incomes.first().getByLabel('Valor').fill('100');
  await finances.getByRole('button', { name: 'Adicionar' }).click();
  await incomes.nth(1).getByLabel('Valor').fill('9.000,50');
  // Removing the first income must not hand its typed amount to the one left.
  await incomes.first().getByRole('button', { name: 'Remover' }).click();
  await expect(incomes).toHaveCount(1);
  await expect(incomes.first().getByLabel('Valor')).toHaveValue('9.000,50');
  await finances
    .getByLabel('Tipo')
    .selectOption({ label: 'De trabalho, como salário ou serviços' });
  await finances.getByLabel('País de onde vem').selectOption({ label: 'Brasil' });
  await radio(finances, 'Ana depende do dinheiro de alguém do caso?', 'Não depende de ninguém');
  await radio(finances, 'Quais bens Ana tem?', 'Nenhum');
  await radio(finances, 'Esses são todos os bens de Ana?', 'Sim, são todos');
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(violations.map(({ id, nodes }) => [id, nodes.map((node) => node.target)])).toEqual([]);
  await finances.getByRole('button', { name: 'Salvar e continuar' }).click();

  const history = step(page, 'Histórico de imigração');
  await radio(
    history,
    'Ana já teve visto ou residência em algum país, ou problema com imigração?',
    'Não sei',
  );
  await history.getByRole('button', { name: 'Salvar e continuar' }).click();

  const relatives = step(page, 'Família');
  const children = group(relatives, 'Esses são todos os filhos de Ana?');
  await expect(children.getByText('Anotados: Criança.')).toBeVisible();
  await children.getByRole('radio', { name: 'Sim, são todos' }).check();
  await relatives.getByLabel('Filiação').selectOption({ label: 'Biológica' });
  await relatives.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Respostas salvas.')).toBeVisible();
  const steps = page.getByRole('navigation', { name: 'Etapas' });
  await expect(steps.getByRole('button', { name: /Finanças\s*4 de 4 respondidas/ })).toBeVisible();

  // "Não sei" leaves the history open, so a new visit starts there.
  await page.reload();
  await expect(step(page, 'Histórico de imigração')).toBeVisible();
  await steps.getByRole('button', { name: /Finanças/ }).click();
  await expect(group(step(page, 'Finanças'), 'Quanto por mês').getByLabel('Valor')).toHaveValue(
    '9000,5',
  );

  // The summary reads the case back, and a sentence opens the question that sets it.
  await page.getByRole('button', { name: 'Ver o resumo do caso' }).click();
  const ana = page.getByRole('region', { name: 'Ana' });
  await expect(ana.getByText(/^Nascimento de Ana: abril de 1985 \(\d+ anos\)\.$/)).toBeVisible();
  await expect(
    ana.getByText(/^Renda de Ana: R\$\s9\.000,50 por mês, de trabalho \(Brasil\)\.$/),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Vínculos' })
      .getByText('Ana é mãe ou pai de Criança, filiação biológica.'),
  ).toBeVisible();
  const summary = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(summary.violations.map(({ id, nodes }) => [id, nodes.map((node) => node.target)])).toEqual(
    [],
  );
  await ana
    .getByRole('button', {
      name: 'Ainda sem resposta: Ana já teve visto ou residência em algum país, ou problema com imigração?',
    })
    .click();
  await expect(step(page, 'Histórico de imigração')).toBeVisible();

  await radio(page.locator('main'), 'De quem são as respostas?', 'Criança');
  await expect(step(page, 'Dados básicos')).toBeVisible();
  await expect(group(step(page, 'Dados básicos'), 'Quando Criança nasceu?')).toBeVisible();
  expect(problems).toEqual([]);
});

test('lists every route for the family by its status, with nothing hidden behind it', async ({
  page,
}) => {
  const problems = watchProblems(page);
  await signedIn(page);
  await family(page);
  await page.getByRole('link', { name: 'Ver as rotas para a família' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Rotas para a família' })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 3, name: 'Perguntas que mudam o resultado' }),
  ).toBeVisible();
  // Each route shows a status for each member, Ana and her child.
  const statuses = page.getByText(/como requerente principal/);
  await expect(statuses.first()).toBeVisible();
  const routes = await page.locator('main article').count();
  expect(routes).toBeGreaterThan(0);
  expect(await statuses.count()).toBe(routes * 2);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(violations.map(({ id, nodes }) => [id, nodes.map((node) => node.target)])).toEqual([]);
  await page.getByRole('link', { name: 'Voltar para a área da família' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Área da família' })).toBeVisible();
  expect(problems).toEqual([]);
});
