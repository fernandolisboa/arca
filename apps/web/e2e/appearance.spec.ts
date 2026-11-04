import { palettes } from '@arca/ui/theme';
import { expect, test, type Page } from '@playwright/test';
import { reportViolations, watchProblems } from './problems.js';

test.beforeEach(async ({ page }) => {
  await reportViolations(page);
});

async function store(page: Page, value: string) {
  await page.addInitScript((stored) => {
    localStorage.setItem('arca.appearance', stored);
  }, value);
}

/** The attributes and theme color as the boot script left them, before the app's own code ran. */
async function firstPaint(page: Page) {
  const seen: Record<string, string | null>[] = [];
  await page.exposeFunction('arcaRecord', (entry: Record<string, string | null>) => {
    seen.push(entry);
  });
  await page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return;
      const root = document.documentElement;
      const record = (window as unknown as { arcaRecord: (entry: unknown) => void }).arcaRecord;
      record({
        theme: root.getAttribute('data-theme'),
        mode: root.getAttribute('data-mode'),
        nav: root.getAttribute('data-nav-narrow'),
        motion: root.getAttribute('data-motion'),
        color: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
      });
    });
  });
  await page.goto('/');
  await expect.poll(() => seen.length).toBeGreaterThan(0);
  return seen[0];
}

test('applies stored choices before the app starts', async ({ page }) => {
  const problems = watchProblems(page);
  await store(
    page,
    JSON.stringify({ v: 1, axes: { theme: 'panel', mode: 'light', navNarrow: 'fixed-dock' } }),
  );
  expect(await firstPaint(page)).toEqual({
    theme: 'panel',
    mode: 'light',
    nav: 'fixed-dock',
    motion: 'on',
    color: palettes.panel.light.bg.toLowerCase(),
  });
  expect(problems).toEqual([]);
});

test('follows the device in system mode for the theme color', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await store(page, JSON.stringify({ v: 1, axes: { theme: 'serene', mode: 'system' } }));
  await page.goto('/');
  const meta = page.locator('meta[name="theme-color"]');
  await expect(meta).toHaveAttribute('content', palettes.serene.dark.bg.toLowerCase());
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(meta).toHaveAttribute('content', palettes.serene.light.bg.toLowerCase());
});

test('falls back to the defaults on tampered or unknown values', async ({ page }) => {
  const problems = watchProblems(page);
  await store(
    page,
    JSON.stringify({
      v: 1,
      axes: { theme: '"><script>alert(1)</script>', mode: 'neon', motion: 'off' },
    }),
  );
  expect(await firstPaint(page)).toEqual({
    theme: 'notebook',
    mode: 'dark',
    nav: 'menu',
    motion: 'off',
    color: palettes.notebook.dark.bg.toLowerCase(),
  });
  expect(problems).toEqual([]);
});

test('ships the boot script as a small precached file without React', async ({ page }) => {
  await page.goto('/');
  const script = page.locator('head script[src="/appearance-boot.js"]');
  await expect(script).toHaveCount(1);
  // After the stylesheet, so the boot script reads the resolved background for theme-color.
  await expect(
    page.locator('head link[rel="stylesheet"] ~ script[src="/appearance-boot.js"]'),
  ).toHaveCount(1);
  expect(await script.getAttribute('type')).toBeNull();
  expect(await page.locator('script:not([src])').count()).toBe(0);

  const source = await (await page.request.get('/appearance-boot.js')).text();
  expect(source.length).toBeLessThan(4096);
  expect(source).not.toMatch(/react/i);

  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        for (const name of await caches.keys()) {
          for (const request of await (await caches.open(name)).keys()) {
            if (new URL(request.url).pathname === '/appearance-boot.js') return true;
          }
        }
        return false;
      }),
    )
    .toBe(true);
});

test('follows a change made in another tab', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto('/');
  await second.goto('/');
  await first.evaluate(() => {
    localStorage.setItem(
      'arca.appearance',
      JSON.stringify({ v: 1, axes: { theme: 'panel', mode: 'light' } }),
    );
  });
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'panel');
  await expect(second.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    palettes.panel.light.bg.toLowerCase(),
  );
  await first.evaluate(() => {
    localStorage.removeItem('arca.appearance');
  });
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'notebook');
});

test('uses the defaults when storage is off', async ({ page }) => {
  const problems = watchProblems(page);
  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    Storage.prototype.getItem = blocked;
    Storage.prototype.setItem = blocked;
    Storage.prototype.removeItem = blocked;
  });
  expect(await firstPaint(page)).toEqual({
    theme: 'notebook',
    mode: 'dark',
    nav: 'menu',
    motion: 'on',
    color: palettes.notebook.dark.bg.toLowerCase(),
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Arca' })).toBeVisible();
  expect(problems).toEqual([]);
});
