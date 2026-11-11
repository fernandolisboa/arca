import { createRequire } from 'node:module';
import { axes, type FontRole, fontPairs } from '@arca/ui/theme';
import { expect, test, type Page } from '@playwright/test';
import { reportViolations, watchProblems } from './problems.js';

const fromUi = createRequire(new URL('../../../packages/ui/package.json', import.meta.url));

/** Faces a role loads for "aą": latin, plus latin-ext when its package ships that subset. */
function expectedFaces(role: FontRole): number {
  const { subsets } = fromUi(`${role.source.package}/metadata.json`) as { subsets: string[] };
  return subsets.includes('latin-ext') ? 2 : 1;
}

test.beforeEach(async ({ page }) => {
  await reportViolations(page);
});

test('loads every font pair from the app itself without a CSP violation', async ({ page }) => {
  const problems = watchProblems(page);
  const fontRequests: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'font') fontRequests.push(request.url());
  });
  await page.goto('/');

  for (const id of axes.font.values) {
    const { display, body, numeric } = fontPairs[id];
    const loaded = await page.evaluate(
      async ({ id, roles }) => {
        const root = document.documentElement;
        root.setAttribute('data-font', id);
        const style = getComputedStyle(root);
        // "aą" falls in both the latin and the latin-ext ranges, so both faces load when present.
        const faces = await Promise.all(
          roles.map((role) =>
            document.fonts.load(`${String(role.weight)} 16px "${role.family}"`, 'aą'),
          ),
        );
        return {
          faces: faces.map((list) => list.length),
          families: ['display', 'body', 'numeric'].map((role) =>
            style.getPropertyValue(`--arca-font-${role}`),
          ),
        };
      },
      { id, roles: [display, body, numeric].map(({ family, weight }) => ({ family, weight })) },
    );
    expect(loaded.faces, id).toEqual([display, body, numeric].map(expectedFaces));
    [display, body, numeric].forEach((role, index) => {
      expect(loaded.families[index], id).toContain(role.family);
    });
  }

  expect(fontRequests.length).toBeGreaterThan(0);
  for (const url of fontRequests) expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  expect(problems).toEqual([]);
});

/** Paths of the font files in the service worker's caches. */
async function cachedFonts(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const fonts: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        const path = new URL(request.url).pathname;
        if (path.endsWith('.woff2')) fonts.push(path);
      }
    }
    return fonts;
  });
}

test('precaches only the default font pair', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(async () => (await cachedFonts(page)).length).toBeGreaterThan(0);

  const pair = fontPairs[axes.font.default];
  const ids = new Set([pair.display, pair.body, pair.numeric].map((role) => role.source.id));
  const expected = [...ids].flatMap((id) => [`/assets/${id}-latin-`, `/assets/${id}-latin-ext-`]);
  const cached = await cachedFonts(page);
  expect(cached).toHaveLength(expected.length);
  for (const prefix of expected) {
    expect(
      cached.filter(
        (path) => path.startsWith(prefix) && !path.slice(prefix.length).startsWith('ext-'),
      ),
      prefix,
    ).toHaveLength(1);
  }
});
