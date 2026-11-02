import { expect, test, type Page } from '@playwright/test';

/** Console errors, uncaught errors and CSP or Trusted Types violations seen by the page. */
function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(
        `CSP violation: ${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${String(event.lineNumber)}:${String(event.columnNumber)} ${event.sample}`,
      );
    });
  });
});

async function activeServiceWorker(page: Page) {
  return page.evaluate(async () => {
    const { active } = await navigator.serviceWorker.ready;
    if (active?.state === 'activating') {
      await new Promise((resolve) => {
        active.addEventListener('statechange', resolve, { once: true });
      });
    }
    return { state: active?.state, url: active?.scriptURL };
  });
}

test('renders the home page in pt-BR with the API status', async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page).toHaveTitle('Arca');
  await expect(page.getByRole('heading', { level: 1, name: 'Arca' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Status do serviço' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Funcionando com limitações');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  expect(problems).toEqual([]);
});

test('activates the service worker without any violation', async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto('/');
  expect(await activeServiceWorker(page)).toEqual({
    state: 'activated',
    url: 'http://127.0.0.1:4173/sw.js',
  });
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(
    'http://127.0.0.1:4173/sw.js',
  );
  await expect(page.getByRole('status')).toHaveText('Funcionando com limitações');
  expect(problems).toEqual([]);
});

test('never caches /v1 responses', async ({ page, context }) => {
  await page.goto('/');
  await activeServiceWorker(page);
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Funcionando com limitações');

  const cached = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) paths.push(new URL(request.url).pathname);
    }
    return paths;
  });
  expect(cached).toContain('/index.html');
  expect(cached.filter((path) => path === '/v1' || path.startsWith('/v1/'))).toEqual([]);

  // Offline, the shell still loads from the precache but the API status cannot.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Arca' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(
    'Não conseguimos falar com o serviço agora. Tente de novo em instantes.',
  );
  const retry = page.getByRole('button', { name: 'Tentar de novo' });
  const box = await retry.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
});
