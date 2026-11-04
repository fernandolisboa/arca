import { expect, test, type Page } from '@playwright/test';
import {
  horizontalOverflow,
  isWide,
  layoutName,
  open,
  sizes,
  usesMenu,
  type Layout,
} from './layouts.js';
import { reportViolations, watchProblems } from './problems.js';

test.beforeEach(async ({ page }) => {
  await reportViolations(page);
});

async function openHome(page: Page, layout: Layout) {
  await open(page, layout);
  await expect(page.getByRole('heading', { level: 1, name: 'Arca' })).toBeVisible();
}

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

for (const [width, baseLayouts] of sizes) {
  test.describe(`at ${String(width)} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    const layouts = ['100', '150'].flatMap((textSize) =>
      baseLayouts.map((layout) => ({ ...layout, textSize })),
    );
    for (const layout of layouts) {
      const name = `${layoutName(layout)} at ${layout.textSize}%`;

      test(`reaches every item by keyboard in ${name}`, async ({ page }) => {
        const problems = watchProblems(page);
        await openHome(page, layout);
        if (usesMenu(layout, isWide(width))) {
          await tabTo(page, 'Abrir menu');
          await page.keyboard.press('Enter');
          const toggle = page.getByRole('button', { name: 'Fechar menu' });
          await expect(toggle).toHaveAttribute('aria-expanded', 'true');
          await expect(page.getByRole('link', { name: 'Início' })).toBeFocused();

          // Focus stays on the menu button and the panel, wrapping at both ends.
          await page.keyboard.press('Shift+Tab');
          await expect(toggle).toBeFocused();
          await page.keyboard.press('Shift+Tab');
          await expect(page.getByRole('link', { name: 'Configurações' })).toBeFocused();
          await page.keyboard.press('Tab');
          await expect(toggle).toBeFocused();
          await page.keyboard.press('Tab');
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
          await tabTo(page, 'Configurações', 4);
          await expect(page.getByRole('button', { name: 'Abrir menu' })).toHaveCount(0);
        }
        expect(await horizontalOverflow(page)).toBe(0);
        expect(problems).toEqual([]);
      });

      if (hasFixedNav(layout, isWide(width))) {
        test(`keeps content clear of the dock or column in ${name}`, async ({ page }) => {
          await openHome(page, layout);
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
              nav:
                navRect === undefined
                  ? null
                  : { top: navRect.top, left: navRect.left, right: navRect.right },
            };
          });
          if (nav === null) throw new Error('no dock or column is on screen');
          if (layout.wide === 'side' && isWide(width))
            expect(content.left).toBeGreaterThanOrEqual(nav.right);
          else if (layout.edge === 'left' && layout.narrow !== 'fixed-dock')
            expect(content.left).toBeGreaterThanOrEqual(nav.right);
          else if (layout.edge === 'right' && layout.narrow !== 'fixed-dock')
            expect(content.right).toBeLessThanOrEqual(nav.left);
          else expect(content.bottom).toBeLessThanOrEqual(nav.top);
        });
      }
    }
  });
}

test.describe('floating dock', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('stays put when its grip is only tapped', async ({ page }) => {
    await openHome(page, { narrow: 'floating-dock', wide: 'menu', edge: 'bottom' });
    const dock = page.locator('nav[data-dock="floating"]');
    await dock.locator('[data-dock-grip]').click();
    await expect(dock).toHaveAttribute('data-edge', 'bottom');
  });

  test('snaps to the nearest edge when dragged by its grip', async ({ page }) => {
    await openHome(page, { narrow: 'floating-dock', wide: 'menu', edge: 'bottom' });
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
