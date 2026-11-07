import AxeBuilder from '@axe-core/playwright';
import type { KnowledgeVersions, VersionView } from '@arca/api-contract/client';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { family, signedIn } from './case-accounts.js';
import { seededCredential, virtualAuthenticator, withoutAutofill } from './passkeys.js';
import {
  clearKnowledgeDecisions,
  resetRateLimits,
  restartSeededCounter,
  runSeed,
} from './postgres/accounts.js';
import { horizontalOverflow } from './layouts.js';
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

// In this file, after the sign-in above: both use the seed passkey, whose counter one shares.
test('the seed approver activates a version, reads and closes its reports, then rejects it (spec 0007, R7 and R8)', async ({
  browser,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'runs once, on the desktop project');
  const [account] = await runSeed();
  if (account === undefined) throw new Error('the seed lists no account');
  await Promise.all([
    restartSeededCounter(account.id),
    clearKnowledgeDecisions(),
    resetRateLimits(),
  ]);
  const problems = watchProblems(page);
  await virtualAuthenticator(page, seededCredential(account.passkey.label), {
    userId: account.id,
  });
  await withoutAutofill(page);
  await page.goto(`${databaseServer.origin}/sign-in`);
  await page.getByRole('button', { name: 'Entrar com chave de acesso' }).click();
  await expect(page.getByText(`Você entrou como ${account.email}.`)).toBeVisible();
  const { version, fallback } = await eb5InEffect(page);

  await page.goto(`${databaseServer.origin}/settings`);
  await page
    .getByRole('navigation', { name: 'Categorias' })
    .getByRole('link', { name: 'Base de conhecimento' })
    .click();
  await page.getByRole('link', { name: 'Abrir a tela de ativação' }).click();
  const proposed = page.getByRole('region', { name: 'Versões propostas' });
  await proposed
    .getByRole('button', { name: new RegExp(`^EB-5 immigrant investor .* versão ${version}\\b`) })
    .click();
  await expect(
    page.getByRole('heading', { level: 3, name: new RegExp(`EB-5 .* versão ${version}\\b`) }),
  ).toBeVisible();
  // The review is a wizard: Next and Back move one step, the step list jumps to any of them.
  await expect(page.getByRole('region', { name: 'O que mudou' })).toBeVisible();
  await page.getByRole('button', { name: 'Próximo: Configurações da versão' }).click();
  await expect(
    page.getByRole('heading', { level: 4, name: 'Configurações da versão' }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(page.getByRole('region', { name: 'O que mudou' })).toBeVisible();
  await reviewStep(page, 'Requisitos');
  await expect(page.getByRole('region', { name: 'Requisitos' })).toContainText(
    'soma dos bens fáceis de transformar em dinheiro da unidade é maior ou igual a',
  );
  await reviewStep(page, 'Fontes');
  await expect(page.getByRole('region', { name: 'Fontes' })).toContainText('https://');
  // On a phone the step list scrolls on its own; the page never scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await horizontalOverflow(page)).toBe(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await reviewStep(page, 'Decisão');
  await expect(page.getByRole('region', { name: 'Verificação independente' })).toContainText(
    'ainda não existe',
  );
  await page.getByRole('button', { name: 'Resumir regra' }).click();
  const summary = page.getByRole('region', { name: 'Resumo feito pela IA' });
  await expect(summary).toContainText('Resumo de teste de EB-5');
  await expect(summary).toContainText('A IA pode errar.');
  // The server keeps the summary, so it is still there after a reload, with no button to ask again.
  await page.reload();
  await proposed
    .getByRole('button', { name: new RegExp(`^EB-5 immigrant investor .* versão ${version}\\b`) })
    .click();
  await expect(summary).toContainText('Resumo de teste de EB-5');
  await expect(page.getByRole('button', { name: 'Resumir regra' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Etiquetas' })).toContainText('investment');
  await reviewStep(page, 'Decisão');
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(
    violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
  ).toEqual([]);

  const stepUps = watchStepUps(page);
  const activation = page.waitForRequest((request) =>
    request.url().endsWith('/v1/knowledge/versions/activate'),
  );
  await page.getByRole('button', { name: 'Ativar esta versão' }).click();
  await expect(page.getByText('confirme com sua chave de acesso')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('status')).toHaveText('Versão ativada.');
  // One request with the version alone, and no passkey prompt (ADR-0027).
  expect((await activation).postDataJSON()).toEqual({ routeId: 'us-eb5', number: Number(version) });
  await expect(page.getByText('Versão ativa', { exact: true })).toBeVisible();

  await memberReportsARequirement(browser);
  await page.reload();
  const reports = page.getByRole('region', { name: 'Avisos de regra errada' });
  await expect(reports).toContainText(new RegExp(`EB-5 .* \\(versão ${version}\\), requisito`));
  await expect(reports).toContainText(/valor errado: \d+ avisos?/);
  await expect(reports).not.toContainText('Uma observação sintética');
  for (const close of await reports
    .getByRole('button', { name: 'Já pesquisei, encerrar os avisos' })
    .all()) {
    await close.click();
  }
  await expect(reports).toContainText('Nenhum aviso aberto.');
  await page
    .getByRole('region', { name: 'Outras versões' })
    .getByRole('button', { name: /^EB-5 immigrant investor/ })
    .click();

  await reviewStep(page, 'Decisão');
  await page.getByRole('button', { name: 'Recusar esta versão' }).click();
  await expect(
    page.getByText(
      new RegExp(
        `Hoje a rota usa esta versão\\. Se recusar, ${
          fallback === null ? 'a rota fica sem versão' : `ela passa para a versão ${fallback}`
        }`,
      ),
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('status')).toHaveText('Versão recusada.');
  await expect(page.getByText('Esta versão foi recusada e não volta a ser usada.')).toBeVisible();
  expect(stepUps).toEqual([]);
  expect(problems).toEqual([]);
});

// In this file, after the tests above, for the same reason.
test('the seed approver reviews, activates and rejects a comparison version (ADR-0026)', async ({
  browser,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'runs once, on the desktop project');
  // A second account builds a family and saves each comparison change, one answer at a time.
  test.setTimeout(90_000);
  const [account] = await runSeed();
  if (account === undefined) throw new Error('the seed lists no account');
  await Promise.all([
    restartSeededCounter(account.id),
    clearKnowledgeDecisions(),
    resetRateLimits(),
  ]);
  const problems = watchProblems(page);
  await virtualAuthenticator(page, seededCredential(account.passkey.label), {
    userId: account.id,
  });
  await withoutAutofill(page);
  await page.goto(`${databaseServer.origin}/sign-in`);
  await page.getByRole('button', { name: 'Entrar com chave de acesso' }).click();
  await expect(page.getByText(`Você entrou como ${account.email}.`)).toBeVisible();

  await page.goto(`${databaseServer.origin}/knowledge`);
  await page
    .getByRole('region', { name: 'Versões propostas' })
    .getByRole('button', { name: /^Destination comparison · versão 1\b/ })
    .click();
  await expect(
    page.getByRole('heading', { level: 3, name: 'Destination comparison · versão 1' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Critérios' })).toContainText('cost-of-living');
  const indicators = page.getByRole('region', { name: 'Indicadores dos países' });
  await expect(indicators).toContainText('Site: data.worldbank.org');
  await expect(
    indicators.getByRole('table', { name: /^Valores de Intentional homicides/ }),
  ).toContainText('Argentina');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await horizontalOverflow(page)).toBe(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(
    violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
  ).toEqual([]);

  const stepUps = watchStepUps(page);
  const activation = page.waitForRequest((request) =>
    request.url().endsWith('/v1/knowledge/comparisons/activate'),
  );
  await page.getByRole('button', { name: 'Ativar esta versão' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('status')).toHaveText('Versão ativada.');
  expect((await activation).postDataJSON()).toEqual({ comparisonId: 'destinations', number: 1 });
  await expect(page.getByText('Versão ativa', { exact: true })).toBeVisible();

  await memberCompares(browser);

  await page.getByRole('button', { name: 'Recusar esta versão' }).click();
  await expect(
    page.getByText('Hoje a comparação usa esta versão. Se recusar, ela fica sem dados de países'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('status')).toHaveText('Versão recusada.');
  await expect(page.getByText('Esta versão foi recusada e não volta a ser usada.')).toBeVisible();
  expect(stepUps).toEqual([]);
  expect(problems).toEqual([]);
});

/** Every step-up the page asks for from now on; a decision asks for none (ADR-0027). */
function watchStepUps(page: Page): string[] {
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/v1/auth/step-up/')) asked.push(request.url());
  });
  return asked;
}

/** Jumps to one step of a version's review from its step list. */
async function reviewStep(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Passos da revisão' })
    .getByRole('button', { name: new RegExp(`^${name}\\b`) })
    .click();
  await expect(page.getByRole('heading', { level: 4, name })).toBeFocused();
}

/** Another account, in its own browser, reports a requirement of the active version (R8). */
async function memberReportsARequirement(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems = watchProblems(page);
  await signedIn(page);
  await family(page);
  await page.getByRole('link', { name: 'Ver as rotas para a família' }).click();
  await page
    .getByRole('article', { name: /^EB-5 immigrant investor/ })
    .getByText('Ver requisitos, custos e prazos')
    .first()
    .click();
  await page.getByRole('button', { name: 'Avisar regra errada' }).first().click();
  const form = page.getByRole('form', { name: 'Avisar regra errada' });
  await form
    .getByRole('group', { name: 'O que parece errado?' })
    .getByRole('radio', { name: 'O valor está errado', exact: true })
    .check();
  await form.getByLabel('Quer contar mais? (opcional)').fill('Uma observação sintética');
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(violations.map(({ id, nodes }) => [id, nodes.map((node) => node.target)])).toEqual([]);
  await form.getByRole('button', { name: 'Enviar aviso' }).click();
  await expect(
    page.getByText('Aviso enviado. Quem revisa as regras vai conferir esta regra.'),
  ).toBeVisible();
  expect(problems).toEqual([]);
  await context.close();
}

/**
 * Another account, in its own browser, compares destinations on the active comparison version
 * (#316): with weights that leave only climate counting, its stars order two countries, and hiding
 * the first moves the second up. Every number on the screen comes from the API.
 */
async function memberCompares(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems = watchProblems(page);
  await signedIn(page);
  await family(page);
  await page.getByRole('link', { name: 'Comparar', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 2, name: 'Comparar destinos' })).toBeVisible();
  const ranking = page.getByRole('region', { name: 'Seu ranking' });
  const places = ranking.getByRole('heading', { level: 4 });
  await expect(places.first()).toHaveText(/^1º lugar /);
  // Each change is saved as it is made; the next step waits for the API's answer.
  const saved = async (change: Promise<void>) => {
    const answer = page.waitForResponse((response) =>
      response.url().endsWith('/v1/comparison/preferences'),
    );
    await change;
    expect((await answer).status()).toBe(200);
  };

  const weights = page.getByRole('region', { name: 'Seus pesos' });
  const weigh = (criterion: string, weight: number) =>
    saved(
      weights
        .getByRole('group', { name: criterion })
        .getByRole('radio', { name: String(weight), exact: true })
        .check(),
    );
  for (const criterion of ['Custo de vida', 'Segurança', 'Saúde', 'Idioma']) {
    await weigh(criterion, 0);
  }
  await weigh('Clima', 5);
  await expect(ranking).toContainText('Nenhum país tem nota em pelo menos metade do seu peso');

  const fewData = page.getByRole('region', { name: 'Poucos dados' });
  // A click, not check(): the rated country can move to another group as soon as the API
  // answers, and its card there opens with the notes closed.
  const rate = async (country: string, stars: string) => {
    const card = page.getByRole('article', { name: new RegExp(`${country}$`) });
    await card.getByText('Ver as notas').click();
    await saved(
      card
        .getByRole('group', { name: `Sua nota para Clima em ${country}` })
        .getByRole('radio', { name: stars })
        .click(),
    );
  };
  await rate('Portugal', '2 estrelas de 5');
  await rate('Uruguai', '5 estrelas de 5');
  await expect(places).toHaveText(['1º lugar Uruguai', '2º lugar Portugal']);
  await expect(ranking.getByRole('article').first()).toContainText('nota final 10 de 10');
  await expect(fewData).not.toContainText('Uruguai');

  await saved(ranking.getByRole('button', { name: 'Ocultar Uruguai' }).click());
  await expect(places).toHaveText(['1º lugar Portugal']);
  const hidden = page.getByRole('region', { name: 'Países ocultos' });
  await expect(hidden).toContainText('Uruguai');

  // The choices are the account's own and come back on the next visit.
  await page.reload();
  await expect(places).toHaveText(['1º lugar Portugal']);
  await expect(
    weights.getByRole('group', { name: 'Clima' }).getByRole('radio', { name: '5', exact: true }),
  ).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await horizontalOverflow(page)).toBe(0);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(violations.map(({ id, nodes }) => [id, nodes.map((node) => node.target)])).toEqual([]);

  await saved(hidden.getByRole('button', { name: 'Mostrar de novo: Uruguai' }).click());
  await expect(places).toHaveText(['1º lugar Uruguai', '2º lugar Portugal']);
  expect(problems).toEqual([]);
  await context.close();
}

/**
 * The EB-5 version the server selects today and the one it would fall back to on rejection, from
 * the approver's own API: evaluations run on the real clock, so a version dated in the future takes
 * over on its date.
 */
async function eb5InEffect(page: Page): Promise<{ version: string; fallback: string | null }> {
  const api = `${databaseServer.origin}/v1/knowledge/versions`;
  const list = await page.request.get(api);
  expect(list.status()).toBe(200);
  const { versions } = (await list.json()) as KnowledgeVersions;
  for (const { routeId, number } of versions) {
    if (routeId !== 'us-eb5') continue;
    const view = await page.request.get(`${api}/view`, {
      params: { routeId, number: String(number) },
    });
    expect(view.status()).toBe(200);
    const { rejection } = (await view.json()) as VersionView;
    if (rejection.selected) {
      return {
        version: String(number),
        fallback: rejection.fallback === null ? null : String(rejection.fallback.number),
      };
    }
  }
  throw new Error('no EB-5 version is in effect today');
}
