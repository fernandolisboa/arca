import { createServer, request as forward } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { reportViolations, watchProblems } from './problems.js';

test.beforeEach(async ({ page }) => {
  await reportViolations(page);
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
  expect(cached.filter((path) => path.endsWith('.map') || path === '/sw.js')).toEqual([]);

  // An excluded prefix never falls back to the shell, with or without a query string.
  for (const path of ['/v1/unknown', '/v1?x=1', '/internal?x=1']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
  await page.goto('/');

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

test('serves pages from the network, so a header change reaches installed clients', async ({
  page,
  baseURL,
}) => {
  // A proxy in front of the server that can rewrite the CSP, as a header-only deploy would.
  const upstream = new URL(baseURL ?? '');
  let tightened = false;
  const proxy = createServer((incoming, outgoing) => {
    const upstreamRequest = forward(
      {
        host: upstream.hostname,
        port: upstream.port,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        const headers = { ...response.headers };
        const policy = headers['content-security-policy'];
        if (tightened && typeof policy === 'string') {
          headers['content-security-policy'] = `${policy}; upgrade-insecure-requests`;
        }
        outgoing.writeHead(response.statusCode ?? 502, headers);
        response.pipe(outgoing);
      },
    );
    incoming.pipe(upstreamRequest);
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${String((proxy.address() as AddressInfo).port)}`;
  try {
    await page.goto(`${origin}/`);
    await activeServiceWorker(page);
    await page.reload();
    tightened = true;
    const response = await page.reload();
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    expect(response?.headers()['content-security-policy']).toMatch(/upgrade-insecure-requests$/);
  } finally {
    await page.close();
    // The service worker can hold a keep-alive connection open, which would stall close().
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
});
