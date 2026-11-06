import { expect, test, type Page } from '@playwright/test';
import { horizontalOverflow } from './layouts.js';
import { reportViolations, watchProblems } from './problems.js';

test.beforeEach(async ({ page }) => {
  await reportViolations(page);
});

const stored = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('arca.appearance');
    return raw === null ? null : (JSON.parse(raw) as { v: number; axes: Record<string, string> });
  });

async function openSettings(page: Page) {
  await page.goto('/');
  // Phones open Settings from the menu; the default wide layout has a gear in its top bar.
  const width = page.viewportSize()?.width ?? 0;
  if (width < 768) await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.getByRole('link', { name: 'Configurações' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Configurações' })).toBeVisible();
}

/** Opens one category from the page's own menu and waits for its heading. */
async function openSection(page: Page, name: string) {
  const link = page.getByRole('navigation', { name: 'Categorias' }).getByRole('link', { name });
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 3, name })).toBeVisible();
}

test('splits the settings into categories and labels every control', async ({ page }) => {
  const problems = watchProblems(page);
  await openSettings(page);
  const categories = page.getByRole('navigation', { name: 'Categorias' }).getByRole('link');
  // No session: no approver category. This server has no database, so the account can't load.
  await expect(categories).toHaveText(['Aparência', 'Navegação', 'Acessibilidade', 'Conta']);
  await expect(page.getByRole('heading', { level: 3, name: 'Aparência' })).toBeVisible();

  const sections = [
    ['Aparência', ['Cores', 'Claro ou escuro', 'Fontes', 'Cantos']],
    ['Navegação', ['Navegação no celular', 'Navegação em telas grandes']],
    ['Acessibilidade', ['Tamanho do texto', 'Contraste', 'Animações']],
  ] as const;
  let total = 0;
  for (const [section, legends] of sections) {
    await openSection(page, section);
    await expect(page.getByRole('group')).toHaveCount(legends.length);
    for (const legend of legends) {
      await expect(page.getByRole('group', { name: legend })).toBeVisible();
    }
    const radios = page.getByRole('radio');
    const count = await radios.count();
    for (let index = 0; index < count; index += 1) {
      await expect(radios.nth(index)).toHaveAccessibleName(/\S/);
    }
    total += count;
  }
  expect(total).toBeGreaterThan(30);

  await openSection(page, 'Conta');
  await expect(page.getByText('Não deu para carregar sua conta agora.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('opens the category the address names, and the first one for an unknown name', async ({
  page,
}) => {
  await page.goto('/settings?section=accessibility');
  await expect(page.getByRole('heading', { level: 3, name: 'Acessibilidade' })).toBeVisible();
  await page.goto('/settings?section=knowledge');
  await expect(page.getByRole('heading', { level: 3, name: 'Aparência' })).toBeVisible();
});

test('applies a choice at once and clears it back to the default', async ({ page }) => {
  await openSettings(page);
  const colors = page.getByRole('group', { name: 'Cores' });
  await expect(colors.getByRole('radio', { name: 'Padrão (Papel)' })).toBeChecked();

  await colors.getByRole('radio', { name: 'Painel' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'panel');
  expect(await stored(page)).toEqual({ v: 1, axes: { theme: 'panel' } });

  // Picking the default value explicitly is a choice of its own, kept in storage.
  await colors.getByRole('radio', { name: 'Papel', exact: true }).check();
  expect(await stored(page)).toEqual({ v: 1, axes: { theme: 'paper' } });

  await colors.getByRole('radio', { name: 'Padrão (Papel)' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  expect(await stored(page)).toBeNull();
});

test('works by keyboard and clears one category at a time', async ({ page }) => {
  await openSettings(page);
  const corners = page.getByRole('group', { name: 'Cantos' });
  await corners.getByRole('radio', { name: 'Padrão (Suaves)' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(corners.getByRole('radio', { name: 'Suaves', exact: true })).toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('html')).toHaveAttribute('data-corners', 'square');

  await openSection(page, 'Acessibilidade');
  await page
    .getByRole('group', { name: 'Tamanho do texto' })
    .getByRole('radio', { name: '150%' })
    .check();
  await expect(page.locator('html')).toHaveAttribute('data-text-size', '150');

  await page.getByRole('button', { name: 'Voltar estas opções ao padrão' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Estas opções voltaram ao padrão.' }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-text-size', '100');
  // The other category keeps its choice until its own reset.
  await expect(page.locator('html')).toHaveAttribute('data-corners', 'square');
  expect(await stored(page)).toEqual({ v: 1, axes: { corners: 'square' } });

  await openSection(page, 'Aparência');
  await page.getByRole('button', { name: 'Voltar estas opções ao padrão' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-corners', 'soft');
  expect(await stored(page)).toBeNull();
});

test('shows the dock side only with the floating dock', async ({ page }) => {
  const problems = watchProblems(page);
  await openSettings(page);
  await openSection(page, 'Navegação');
  const side = page.getByRole('group', { name: 'Lado da barra flutuante' });
  await expect(side).toHaveCount(0);
  await page
    .getByRole('group', { name: 'Navegação no celular' })
    .getByRole('radio', { name: 'Barra flutuante' })
    .check();
  await expect(side).toBeVisible();
  await side.getByRole('radio', { name: 'Direita' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-dock-edge', 'right');
  expect(problems).toEqual([]);
});

test('fits a phone screen in every category, with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettings(page);
  for (const section of ['Aparência', 'Navegação', 'Acessibilidade', 'Conta']) {
    await openSection(page, section);
    expect(await horizontalOverflow(page)).toBe(0);
  }
});
