import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { defaultLayout, isWide, layoutName, open, sizes, usesMenu } from './layouts.js';
import { reportViolations, watchProblems } from './problems.js';

test.beforeEach(async ({ page }) => {
  await reportViolations(page);
});

/** The default theme, and one light theme with a different palette (spec 0006, R11). */
const themes = [
  { name: 'the default theme', axes: {} },
  { name: 'Sereno, light', axes: { theme: 'serene', mode: 'light' } },
] as const;

async function scan(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  return violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }));
}

for (const [width, layouts] of sizes) {
  test.describe(`at ${String(width)} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const theme of themes) {
      for (const layout of layouts) {
        test(`home has no axe violation in ${layoutName(layout)}, ${theme.name}`, async ({
          page,
        }) => {
          const problems = watchProblems(page);
          await open(page, layout, { extra: theme.axes });
          await expect(page.getByRole('heading', { level: 1, name: 'Arca' })).toBeVisible();
          expect(await scan(page)).toEqual([]);

          // The open menu is part of the page too.
          if (usesMenu(layout, isWide(width))) {
            await page.getByRole('button', { name: 'Abrir menu' }).click();
            await expect(page.getByRole('button', { name: 'Fechar menu' })).toBeVisible();
            expect(await scan(page)).toEqual([]);
          }
          expect(problems).toEqual([]);
        });
      }

      test(`Settings has no axe violation in ${theme.name}`, async ({ page }) => {
        const problems = watchProblems(page);
        await open(page, defaultLayout, { path: '/settings', extra: theme.axes });
        await expect(page.getByRole('heading', { level: 2, name: 'Configurações' })).toBeVisible();
        expect(await scan(page)).toEqual([]);
        expect(problems).toEqual([]);
      });

      test(`the enrollment form has no axe violation in ${theme.name}`, async ({ page }) => {
        const problems = watchProblems(page);
        await open(page, defaultLayout, { path: '/enroll', extra: theme.axes });
        await expect(
          page.getByRole('heading', { level: 2, name: 'Criar a primeira conta' }),
        ).toBeVisible();
        expect(await scan(page)).toEqual([]);
        expect(problems).toEqual([]);
      });
    }
  });
}
