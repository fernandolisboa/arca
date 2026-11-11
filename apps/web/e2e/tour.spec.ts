import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signedIn } from './case-accounts.js';
import { resetRateLimits } from './postgres/accounts.js';
import { watchProblems } from './problems.js';
import { databaseServer } from './servers.js';
import { notToured } from './tour.js';

test.skip(!databaseServer.enabled, 'needs ARCA_E2E_DATABASE and a Postgres (see README)');
test.use({ storageState: notToured });
test.beforeAll(async () => {
  await resetRateLimits();
});

const coachMark = (page: Page, title: string) => page.getByRole('dialog', { name: title });

const appSteps = [
  'Comece pelo Início',
  'Quem vai com você',
  'Para onde ir',
  'Documentos trancados',
  'Do seu jeito',
];

test('walks a new account through the app once, then hints at a screen once', async ({ page }) => {
  const problems = watchProblems(page);
  await signedIn(page);
  await page.goto(`${databaseServer.origin}/`);

  for (const [index, title] of appSteps.entries()) {
    const step = coachMark(page, title);
    await expect(step).toBeVisible();
    await expect(step).toBeFocused();
    await expect(
      step.getByText(`${String(index + 1)} de ${String(appSteps.length)}`),
    ).toBeVisible();
    // The spotlight sits on something the person can see, in every layout.
    const spotlight = await page.locator('[data-coach-spotlight]').boundingBox();
    expect(spotlight?.width).toBeGreaterThan(0);
    if (index === 0) {
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(violations.map(({ id }) => id)).toEqual([]);
    }
    const last = index === appSteps.length - 1;
    await step.getByRole('button', { name: last ? 'Concluir' : 'Próximo' }).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { level: 3, name: 'Começar o caso' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto(`${databaseServer.origin}/family`);
  const hint = coachMark(page, 'Comece por aqui');
  await expect(hint.getByRole('button')).toHaveText(['Entendi']);
  await hint.getByRole('button', { name: 'Entendi' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Área da família' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('skips the tour with Escape and shows it again from Settings', async ({ page }) => {
  await signedIn(page);
  await page.goto(`${databaseServer.origin}/`);
  await expect(coachMark(page, appSteps[0] ?? '')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto(`${databaseServer.origin}/settings?section=help`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ver o tour de novo' }).click();
  await expect(page).toHaveURL(`${databaseServer.origin}/`);
  await expect(coachMark(page, appSteps[0] ?? '')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto(`${databaseServer.origin}/settings?section=help`);
  await page.getByRole('button', { name: 'Mostrar as dicas de novo' }).click();
  await expect(page.getByRole('status')).toContainText('Cada dica volta a aparecer');
});
