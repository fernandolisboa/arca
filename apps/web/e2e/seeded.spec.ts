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

  const stepUp = page.waitForRequest((request) =>
    request.url().endsWith('/v1/auth/step-up/options'),
  );
  await page.getByRole('button', { name: 'Ativar esta versão' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('status')).toHaveText('Versão ativada.');
  expect((await stepUp).postDataJSON()).toMatchObject({
    purpose: 'knowledge_decision',
    target: { action: 'activateVersion', targets: ['us-eb5', version] },
  });
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
  expect(problems).toEqual([]);
});

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
