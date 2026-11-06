import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { family, signedIn } from './case-accounts.js';
import { seededCredential, virtualAuthenticator, withoutAutofill } from './passkeys.js';
import {
  clearKnowledgeDecisions,
  resetRateLimits,
  restartSeededCounter,
  runSeed,
} from './postgres/accounts.js';
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
  const number = await eb5VersionInEffect();
  const version = String(number);
  const problems = watchProblems(page);
  await virtualAuthenticator(page, seededCredential(account.passkey.label), {
    userId: account.id,
  });
  await withoutAutofill(page);
  await page.goto(`${databaseServer.origin}/sign-in`);
  await page.getByRole('button', { name: 'Entrar com chave de acesso' }).click();
  await expect(page.getByText(`Você entrou como ${account.email}.`)).toBeVisible();

  await page.goto(`${databaseServer.origin}/settings`);
  await page.getByRole('link', { name: 'Abrir a tela de ativação' }).click();
  const proposed = page.getByRole('region', { name: 'Versões propostas' });
  await proposed
    .getByRole('button', { name: new RegExp(`^EB-5 immigrant investor .* versão ${version}\\b`) })
    .click();
  await expect(
    page.getByRole('heading', { level: 3, name: new RegExp(`EB-5 .* versão ${version}\\b`) }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Requisitos' })).toContainText(
    'soma dos bens fáceis de transformar em dinheiro da unidade é maior ou igual a',
  );
  await expect(page.getByRole('region', { name: 'Verificação independente' })).toContainText(
    'ainda não existe',
  );
  await expect(page.getByRole('region', { name: 'Fontes' })).toContainText('https://');
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

  await page.getByRole('button', { name: 'Recusar esta versão' }).click();
  const fallback =
    number === 1 ? 'a rota fica sem versão' : `ela passa para a versão ${String(number - 1)}`;
  await expect(
    page.getByText(new RegExp(`Hoje a rota usa esta versão\\. Se recusar, ${fallback}`)),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('status')).toHaveText('Versão recusada.');
  await expect(page.getByText('Esta versão foi recusada e não volta a ser usada.')).toBeVisible();
  expect(problems).toEqual([]);
});

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
 * The EB-5 version the server selects today: it evaluates on the real clock in São Paulo
 * (`todayInSaoPaulo` in the API), so a version dated in the future takes over on its date.
 */
async function eb5VersionInEffect(): Promise<number> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
  const folder = new URL('../../../packages/knowledge/data/routes/us-eb5/', import.meta.url);
  const versions = await Promise.all(
    (await readdir(folder))
      .filter((name) => /^\d+\.json$/.test(name))
      .map(async (name) => {
        const { number, effectiveFrom } = JSON.parse(
          await readFile(new URL(name, folder), 'utf8'),
        ) as { number: number; effectiveFrom: string };
        return { number, effectiveFrom };
      }),
  );
  const inEffect = versions
    .filter(({ effectiveFrom }) => effectiveFrom <= today)
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
    .at(-1);
  if (inEffect === undefined) throw new Error('no EB-5 version is in effect today');
  return inEffect.number;
}
