import { expect, test, type Page } from '@playwright/test';
import { reportViolations, watchProblems } from './problems.js';

test.beforeEach(async ({ page }) => {
  await reportViolations(page);
});

interface Layout {
  readonly narrow: string;
  readonly wide: string;
  readonly edge: string;
}

/** Stores the layout as the person's choice, so the boot script applies it before first paint. */
async function open(page: Page, layout: Layout) {
  await page.addInitScript((chosen) => {
    const axes = { navNarrow: chosen.narrow, navWide: chosen.wide, dockEdge: chosen.edge };
    localStorage.setItem('arca.appearance', JSON.stringify({ v: 1, axes }));
  }, layout);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Arca' })).toBeVisible();
}

const narrowLayouts: Layout[] = [
  { narrow: 'menu', wide: 'menu', edge: 'bottom' },
  { narrow: 'fixed-dock', wide: 'menu', edge: 'bottom' },
  { narrow: 'floating-dock', wide: 'menu', edge: 'bottom' },
  { narrow: 'floating-dock', wide: 'menu', edge: 'left' },
  { narrow: 'floating-dock', wide: 'menu', edge: 'right' },
];

const wideLayouts: Layout[] = [
  { narrow: 'menu', wide: 'menu', edge: 'bottom' },
  { narrow: 'menu', wide: 'top', edge: 'bottom' },
  { narrow: 'menu', wide: 'side', edge: 'bottom' },
  { narrow: 'menu', wide: 'floating-dock', edge: 'bottom' },
  { narrow: 'menu', wide: 'floating-dock', edge: 'left' },
];

const usesMenu = (layout: Layout, wide: boolean) => (wide ? layout.wide : layout.narrow) === 'menu';

/** A dock or the side column, which the content must stay clear of. */
const hasFixedNav = (layout: Layout, wide: boolean) =>
  wide ? layout.wide === 'side' || layout.wide === 'floating-dock' : layout.narrow !== 'menu';

async function tabTo(page: Page, name: string, limit = 12) {
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.getAttribute('aria-label') ?? active?.textContent.trim() ?? '';
    });
    if (label === name) return;
  }
  throw new Error(`Tab never reached "${name}"`);
}

for (const [width, layouts] of [
  [390, narrowLayouts],
  [1280, wideLayouts],
] as const) {
  test.describe(`at ${String(width)} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const layout of layouts) {
      const name = `${layout.narrow} / ${layout.wide} / ${layout.edge}`;

      test(`reaches every item by keyboard in ${name}`, async ({ page }) => {
        const problems = watchProblems(page);
        await open(page, layout);
        if (usesMenu(layout, width >= 768)) {
          await tabTo(page, 'Abrir menu');
          await page.keyboard.press('Enter');
          const toggle = page.getByRole('button', { name: 'Fechar menu' });
          await expect(toggle).toHaveAttribute('aria-expanded', 'true');
          await expect(page.getByRole('link', { name: 'Início' })).toBeFocused();

          // Focus stays on the menu button and the panel.
          await page.keyboard.press('Tab');
          await expect(toggle).toBeFocused();
          await page.keyboard.press('Shift+Tab');
          await expect(page.getByRole('link', { name: 'Início' })).toBeFocused();

          await page.keyboard.press('Escape');
          const reopen = page.getByRole('button', { name: 'Abrir menu' });
          await expect(reopen).toBeFocused();
          await expect(reopen).toHaveAttribute('aria-expanded', 'false');

          await page.keyboard.press('Enter');
          await page.keyboard.press('Shift+Tab');
          await expect(page.getByRole('button', { name: 'Fechar menu' })).toBeFocused();
          await page.keyboard.press('Enter');
          await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeFocused();
        } else {
          await tabTo(page, 'Início');
          await expect(page.getByRole('link', { name: 'Início' })).toHaveAttribute(
            'aria-current',
            'page',
          );
          await expect(page.getByRole('button', { name: 'Abrir menu' })).toHaveCount(0);
        }
        expect(problems).toEqual([]);
      });

      if (hasFixedNav(layout, width >= 768)) {
        test(`keeps content clear of the dock or column in ${name}`, async ({ page }) => {
          await open(page, layout);
          const { content, nav } = await page.evaluate(() => {
            const main = document.getElementById('main-content');
            main?.append(Object.assign(document.createElement('div'), { style: 'height: 3000px' }));
            window.scrollTo(0, document.documentElement.scrollHeight);
            // The wrapper's content box: what is left once the dock's clearance is taken off.
            const wrapper = main?.parentElement;
            const rect = wrapper?.getBoundingClientRect();
            const style =
              wrapper === null || wrapper === undefined ? null : getComputedStyle(wrapper);
            const pad = (side: 'Top' | 'Bottom' | 'Left' | 'Right') =>
              Number.parseFloat(style?.[`padding${side}`] ?? '0');
            const visibleNav = [...document.querySelectorAll('nav')].find(
              (element) => element.getBoundingClientRect().width > 0 && !element.closest('header'),
            );
            const navRect = visibleNav?.getBoundingClientRect();
            return {
              content: {
                bottom: (rect?.bottom ?? 0) - pad('Bottom'),
                left: (rect?.left ?? 0) + pad('Left'),
                right: (rect?.right ?? 0) - pad('Right'),
              },
              nav: { top: navRect?.top ?? 0, left: navRect?.left ?? 0, right: navRect?.right ?? 0 },
            };
          });
          if (layout.wide === 'side' && width >= 768)
            expect(content.left).toBeGreaterThanOrEqual(nav.right);
          else if (layout.edge === 'left' && layout.narrow !== 'fixed-dock')
            expect(content.left).toBeGreaterThanOrEqual(nav.right);
          else if (layout.edge === 'right' && layout.narrow !== 'fixed-dock')
            expect(content.right).toBeLessThanOrEqual(nav.left);
          else expect(content.bottom).toBeLessThanOrEqual(nav.top);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow).toBe(0);
        });
      }
    }
  });
}

test.describe('floating dock', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('stays put when its grip is only tapped', async ({ page }) => {
    await open(page, { narrow: 'floating-dock', wide: 'menu', edge: 'bottom' });
    const dock = page.locator('nav[data-dock="floating"]');
    await dock.locator('[data-dock-grip]').click();
    await expect(dock).toHaveAttribute('data-edge', 'bottom');
  });

  test('snaps to the nearest edge when dragged by its grip', async ({ page }) => {
    await open(page, { narrow: 'floating-dock', wide: 'menu', edge: 'bottom' });
    const dock = page.locator('nav[data-dock="floating"]');
    await expect(dock).toHaveAttribute('data-edge', 'bottom');
    const grip = dock.locator('[data-dock-grip]');
    const box = await grip.boundingBox();
    if (box === null) throw new Error('the grip is not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(370, 400, { steps: 8 });
    await page.mouse.up();
    await expect(dock).toHaveAttribute('data-edge', 'right');
    await expect(page.locator('html')).toHaveAttribute('data-dock-edge', 'right');
    const stored = await page.evaluate(() => localStorage.getItem('arca.appearance'));
    expect(JSON.parse(stored ?? '{}')).toMatchObject({ v: 1, axes: { dockEdge: 'right' } });
  });
});

test('skips the view transition on the first load and uses it on a page change', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const counted = window as unknown as { transitions: number };
    counted.transitions = 0;
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (update) => {
      counted.transitions += 1;
      return start(update);
    };
  });
  await page.goto('/pagina-que-nao-existe');
  await expect(page.getByRole('link', { name: 'Voltar ao início' })).toBeVisible();
  const transitions = () =>
    page.evaluate(() => (window as unknown as { transitions: number }).transitions);
  expect(await transitions()).toBe(0);
  await page.getByRole('link', { name: 'Voltar ao início' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Status do serviço' })).toBeVisible();
  expect(await transitions()).toBe(1);
});
