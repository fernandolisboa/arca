import { expect, test, type Page } from '@playwright/test';
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
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.getByRole('link', { name: 'Configurações' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Configurações' })).toBeVisible();
}

test('reaches Settings from the menu and labels every control', async ({ page }) => {
  const problems = watchProblems(page);
  await openSettings(page);
  for (const legend of ['Cores', 'Claro ou escuro', 'Fontes', 'Cantos', 'Contraste', 'Animações']) {
    await expect(page.getByRole('group', { name: legend })).toBeVisible();
  }
  const radios = page.getByRole('radio');
  const count = await radios.count();
  expect(count).toBeGreaterThan(30);
  for (let index = 0; index < count; index += 1) {
    await expect(radios.nth(index)).toHaveAccessibleName(/\S/);
  }
  expect(problems).toEqual([]);
});

test('applies a choice at once and clears it back to the default', async ({ page }) => {
  await openSettings(page);
  const colors = page.getByRole('group', { name: 'Cores' });
  await expect(colors.getByRole('radio', { name: 'Padrão (Caderno)' })).toBeChecked();

  await colors.getByRole('radio', { name: 'Painel' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'panel');
  expect(await stored(page)).toEqual({ v: 1, axes: { theme: 'panel' } });

  // Picking the default value explicitly is a choice of its own, kept in storage.
  await colors.getByRole('radio', { name: 'Caderno', exact: true }).check();
  expect(await stored(page)).toEqual({ v: 1, axes: { theme: 'notebook' } });

  await colors.getByRole('radio', { name: 'Padrão (Caderno)' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'notebook');
  expect(await stored(page)).toBeNull();
});

test('works by keyboard and clears every choice at once', async ({ page }) => {
  await openSettings(page);
  const corners = page.getByRole('group', { name: 'Cantos' });
  await corners.getByRole('radio', { name: 'Padrão (Retos)' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(corners.getByRole('radio', { name: 'Retos', exact: true })).toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('html')).toHaveAttribute('data-corners', 'soft');

  await page
    .getByRole('group', { name: 'Tamanho do texto' })
    .getByRole('radio', { name: '150%' })
    .check();
  await expect(page.locator('html')).toHaveAttribute('data-text-size', '150');

  await page.getByRole('button', { name: 'Voltar tudo ao padrão' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Tudo voltou ao padrão.' }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-corners', 'square');
  await expect(page.locator('html')).toHaveAttribute('data-text-size', '100');
  expect(await stored(page)).toBeNull();
});

test('shows the dock side only with the floating dock', async ({ page }) => {
  const problems = watchProblems(page);
  await openSettings(page);
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
