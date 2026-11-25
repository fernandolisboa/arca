import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { family, signedIn } from './case-accounts.js';
import { pickCountry } from './country-picker.js';
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
const press = (scope: Locator, question: string, button: string) =>
  group(scope, question).getByRole('button', { name: button, exact: true }).click();
const saveAndGo = (scope: Locator, next: string) =>
  scope.getByRole('button', { name: `Salvar e ir para ${next}` }).click();

test('fills a family in step by step, with "Não sei", and reads it back', async ({ page }) => {
  const problems = watchProblems(page);
  await signedIn(page);
  await family(page);
  await page.getByRole('link', { name: 'Responder ao questionário' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Questionário' })).toBeVisible();

  const basics = step(page, 'Dados básicos');
  const born = group(basics, 'Quando Ana nasceu?');
  // A half-typed year never goes as "Não sei": the browser keeps the step from being sent.
  await born.getByLabel('Mês').selectOption({ label: 'abril' });
  await saveAndGo(basics, 'Estudos e idiomas');
  await expect(born.getByLabel('Ano')).toHaveJSProperty('validity.valueMissing', true);
  await born.getByLabel('Ano').fill('198');
  await saveAndGo(basics, 'Estudos e idiomas');
  await expect(born.getByLabel('Ano')).toHaveJSProperty('validity.patternMismatch', true);
  await expect(step(page, 'Dados básicos')).toBeVisible();
  await born.getByLabel('Ano').fill('1985');
  await press(basics, 'Quais cidadanias Ana tem ou já teve?', '+ Adicionar cidadania');
  await pickCountry(basics, 'País', 'Brasil');
  await basics.getByLabel('Como conseguiu').selectOption({ label: 'Nascimento' });
  await pickCountry(basics, 'Em que país Ana mora hoje?', 'Brasil');
  await saveAndGo(basics, 'Estudos e idiomas');

  const studies = step(page, 'Estudos e idiomas');
  await studies
    .getByLabel('Qual o maior nível de estudo que Ana concluiu?')
    .selectOption({ label: 'Graduação: bacharelado, licenciatura ou tecnólogo' });
  const courses = 'Que cursos técnicos ou superiores Ana fez?';
  await press(studies, courses, '+ Adicionar curso');
  // A list's items follow its question, so each is found by a field only it has.
  const degree = studies.getByRole('listitem').filter({ hasText: 'Área de formação' });
  await degree
    .getByLabel('Tipo de curso')
    .selectOption({ label: 'Graduação: bacharelado, licenciatura ou tecnólogo' });
  await pickCountry(degree, 'Área de formação', 'Medicina');
  await radio(degree, 'Situação', 'Concluído');
  await pickCountry(degree, 'País da escola', 'Brasil');
  await degree.getByRole('button', { name: 'Pronto' }).click();
  // A course left unfinished may sit above the level finished, since it never raises it.
  await press(studies, courses, '+ Adicionar curso');
  const dropped = studies.getByRole('listitem').filter({ hasText: 'Área de formação' });
  await dropped
    .getByLabel('Tipo de curso')
    .selectOption({ label: 'Pós-graduação: especialização, MBA ou mestrado' });
  await radio(dropped, 'Situação', 'Não concluído');
  await expect(dropped.getByRole('group', { name: 'Quando concluiu' })).toHaveCount(0);
  await dropped.getByRole('button', { name: 'Pronto' }).click();
  await expect(
    group(studies, courses).getByText(
      'Pós-graduação: especialização, MBA ou mestrado · Não concluído',
    ),
  ).toBeVisible();
  await radio(studies, 'Ana está estudando agora?', 'Não');
  await press(studies, 'Que idiomas Ana fala?', '+ Adicionar idioma');
  const spoken = studies.getByRole('listitem').filter({ hasText: 'Idioma' });
  // Only languages with a name in Portuguese are offered, never a bare code.
  await spoken.getByRole('button', { name: /^Idioma / }).click();
  const languages = page.getByRole('dialog', { name: 'Idioma', exact: true });
  await languages.getByRole('searchbox').fill('nd');
  await expect(languages.getByRole('button', { name: 'nd', exact: true })).toHaveCount(0);
  await languages.getByRole('searchbox').fill('português');
  await languages.getByRole('button', { name: 'português', exact: true }).click();
  await spoken.getByLabel('Nível').selectOption({ label: 'Língua materna' });
  await saveAndGo(studies, 'Trabalho');

  const work = step(page, 'Trabalho');
  await press(work, 'Ana tem registro em conselho ou ordem profissional?', 'Não tem registro');
  await press(work, 'Onde Ana trabalha ou já trabalhou?', '+ Adicionar trabalho');
  await work.getByLabel('Nome para reconhecer este trabalho (opcional)').fill('Cliente dos EUA');
  await pickCountry(work, 'Ocupação', 'Desenvolvedores de software');
  await work
    .getByLabel('Forma de trabalho')
    .selectOption({ label: 'Prestando serviço (PJ, freelancer ou autônomo para uma empresa)' });
  await radio(work, 'Cargo de chefia', 'Não sei');
  await radio(work, 'É em tempo integral?', 'Sim');
  await pickCountry(work, 'País da empresa ou do cliente', 'Estados Unidos');
  await pickCountry(work, 'País de onde trabalha', 'Brasil');
  const workStart = group(work, 'Desde quando');
  await workStart.getByLabel('Ano').fill('2022');
  await workStart.getByLabel('Mês').selectOption({ label: 'março' });
  await group(work, 'Até quando').getByLabel('Ainda trabalha aqui').check();
  await press(work, 'Ana tem oferta de emprego em outro país?', 'Não tem oferta');
  // "Voltar" saves the step before going back, so its answers are there on the way forward.
  await work.getByRole('button', { name: 'Voltar' }).click();
  await saveAndGo(step(page, 'Estudos e idiomas'), 'Trabalho');
  await expect(group(work, 'Onde Ana trabalha ou já trabalhou?')).toContainText('Cliente dos EUA');
  await saveAndGo(work, 'Finanças');

  const finances = step(page, 'Finanças');
  const income = 'De onde vem a renda de Ana?';
  await press(finances, income, '+ Adicionar renda');
  const incomes = finances.getByRole('listitem').filter({ has: page.getByLabel('Valor') });
  await incomes.first().getByLabel('Valor').fill('100');
  await press(finances, income, '+ Adicionar renda');
  await incomes.nth(1).getByLabel('Valor').fill('9.000,50');
  // Removing the first income must not hand its typed amount to the one left.
  await incomes.first().getByRole('button', { name: 'Remover' }).click();
  await expect(incomes).toHaveCount(1);
  await expect(incomes.first().getByLabel('Valor')).toHaveValue('9.000,50');
  await radio(finances, 'Tipo', 'De trabalho, como salário ou serviços');
  await pickCountry(finances, 'País de onde vem', 'Brasil');
  await radio(finances, 'Ana depende do dinheiro de alguém do caso?', 'Não depende de ninguém');
  await radio(finances, 'Esses são todos os bens de Ana?', 'Sim, são todos');
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(violations.map(({ id, nodes }) => [id, nodes.map((node) => node.target)])).toEqual([]);
  await saveAndGo(finances, 'Histórico de imigração');

  const history = step(page, 'Histórico de imigração');
  await press(history, 'Em quais países Ana já morou?', '+ Adicionar país');
  await pickCountry(history, 'País', 'Brasil');
  await history.getByLabel('Situação no país').selectOption({ label: 'Com cidadania do país' });
  await group(history, 'Desde quando').getByLabel('Ano').fill('1985');
  await group(history, 'Até quando').getByLabel('Ainda mora lá').check();
  await press(history, 'Ana já teve visto, residência ou algum problema com imigração?', 'Não sei');
  await saveAndGo(history, 'Família');

  const relatives = step(page, 'Família');
  const children = group(relatives, 'Esses são todos os filhos de Ana?');
  await expect(children.getByText('Anotados: Criança.').first()).toBeVisible();
  await children.getByRole('radio', { name: 'Sim, são todos' }).check();
  await radio(relatives, 'Filiação', 'Biológica');
  await relatives.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Respostas salvas.')).toBeVisible();
  const steps = page.getByRole('navigation', { name: 'Etapas' });
  await expect(steps).toContainText('Finanças (4/4)');

  // "Não sei" leaves the history open, so a new visit starts there.
  await page.reload();
  await expect(step(page, 'Histórico de imigração')).toBeVisible();
  // A phone picks the step from a list; a wide screen shows every step.
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    await steps.getByRole('button', { name: /Finanças/ }).click();
  } else {
    await steps.getByRole('combobox').selectOption('finances');
  }
  // A saved income opens as a summary row.
  await expect(group(step(page, 'Finanças'), income).getByText(/^De trabalho/)).toBeVisible();
  await expect(group(step(page, 'Finanças'), income).getByText(/R\$\s9\.000,50/)).toBeVisible();

  // The summary reads the case back, and a sentence opens the question that sets it.
  await page.getByRole('button', { name: 'Ver o resumo do caso' }).click();
  const ana = page.getByRole('region', { name: 'Ana' });
  await expect(ana.getByText(/^Nascimento de Ana: abril de 1985 \(\d+ anos\)\.$/)).toBeVisible();
  await expect(
    ana.getByText(/^Renda de Ana: R\$\s9\.000,50 por mês, de trabalho \(Brasil\)\.$/),
  ).toBeVisible();
  await expect(
    ana.getByText(
      'Trabalho de Ana (Cliente dos EUA): Desenvolvedores de software, prestando serviço, em tempo integral, empresa ou cliente: Estados Unidos, local de trabalho: Brasil, começou em março de 2022, trabalho atual.',
    ),
  ).toBeVisible();
  await expect(
    ana.getByText(
      'Formação de Ana em Medicina (Graduação: bacharelado, licenciatura ou tecnólogo), país: Brasil.',
    ),
  ).toBeVisible();
  await expect(ana.getByText('Registros profissionais de Ana: nenhum.')).toBeVisible();
  await expect(
    ana.getByText('Residência de Ana: Brasil, com cidadania, desde 1985 até hoje.'),
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
      name: 'Ainda sem resposta: Ana já teve visto, residência ou algum problema com imigração?',
    })
    .click();
  await expect(step(page, 'Histórico de imigração')).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Respostas de' })
    .getByRole('button', { name: /^Criança/ })
    .click();
  await expect(step(page, 'Dados básicos')).toBeVisible();
  await expect(group(step(page, 'Dados básicos'), 'Quando Criança nasceu?')).toBeVisible();
  expect(problems).toEqual([]);
});

test('lists every route for the family by its status, with nothing hidden behind it', async ({
  page,
  isMobile,
}) => {
  const problems = watchProblems(page);
  await signedIn(page);
  await family(page);
  await page.getByRole('link', { name: 'Ver as rotas para a família' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Rotas para a família' })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 4, name: /^Perguntas que mudam o resultado/ }),
  ).toBeVisible();
  const caption = 'Rotas da família, com a situação de cada pessoa como requerente principal';
  // Another test may leave every version but one waiting for activation; those only get a count.
  const list = page.getByRole(isMobile ? 'list' : 'table', { name: caption });
  const waiting = page.getByText(/^Ainda sem versão ativa/);
  await expect(list.or(waiting).first()).toBeVisible();
  if ((await list.count()) > 0 && isMobile) {
    // A card per route; the chosen one opens its detail under it.
    const card = list.getByRole('listitem').first();
    await card.getByRole('button', { expanded: false }).click();
    await expect(card.getByText(/como requerente principal/).first()).toBeVisible();
  } else if ((await list.count()) > 0) {
    // Each route shows a status for each member, Ana and her child, and the first opens beside.
    const rows = await list.locator('tbody tr').count();
    expect(rows).toBeGreaterThan(0);
    await expect(list.getByRole('button', { name: /como requerente principal/ })).toHaveCount(
      rows * 2,
    );
    await expect(
      page.getByRole('complementary', { name: 'Detalhes da rota' }).getByRole('heading', {
        level: 3,
      }),
    ).toBeVisible();
  }
  // A route no active version names never shows by its ID.
  await expect(page.locator('main')).not.toContainText('Rota ainda sem versão ativa');
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(violations.map(({ id, nodes }) => [id, nodes.map((node) => node.target)])).toEqual([]);
  await page.getByRole('link', { name: 'Voltar para a área da família' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Área da família' })).toBeVisible();
  expect(problems).toEqual([]);
});
