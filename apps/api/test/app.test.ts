import { createApiClient, ContractViolationError, routes } from '@arca/api-contract/client';
import { HealthResponse } from '@arca/api-contract/routes';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { CheckDatabase } from '../src/database-health.js';
import type { Logger } from '../src/logger.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };

function setup(checkDatabase: CheckDatabase, clock = { ms: 0 }) {
  const app = createApp({ checkDatabase, logger: silentLogger, now: () => clock.ms });
  const client = createApiClient({
    origin: 'http://arca.test',
    fetch: (input, init) => Promise.resolve(app.request(input, init)),
  });
  return { app, client, clock };
}

describe('GET /v1/health', () => {
  it.each([
    ['ok', 'ok'],
    ['unavailable', 'degraded'],
    ['wrong_role', 'degraded'],
  ] as const)('reports database %s as %s, matching the contract', async (database, status) => {
    const { client, app } = setup(() => Promise.resolve(database));
    await expect(client.call(routes.health)).resolves.toEqual({ status, checks: { database } });
    const response = await app.request('/v1/health');
    expect(HealthResponse.safeParse(await response.json()).success).toBe(true);
  });

  it('reports unavailable when the check throws', async () => {
    const { client } = setup(() => Promise.reject(new Error('connection refused')));
    await expect(client.call(routes.health)).resolves.toEqual({
      status: 'degraded',
      checks: { database: 'unavailable' },
    });
  });

  it('caches the database result for 10 seconds per instance', async () => {
    const check = vi.fn<CheckDatabase>(() => Promise.resolve('ok'));
    const { app, clock } = setup(check);
    await app.request('/v1/health');
    clock.ms = 9_999;
    await app.request('/v1/health');
    expect(check).toHaveBeenCalledTimes(1);
    clock.ms = 10_000;
    await app.request('/v1/health');
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('is never cached by clients', async () => {
    const { app } = setup(() => Promise.resolve('ok'));
    const response = await app.request('/v1/health');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('client', () => {
  it('rejects a response that drifts from the contract', async () => {
    const client = createApiClient({
      origin: '',
      fetch: () => Promise.resolve(Response.json({ status: 'fine', checks: {} })),
    });
    await expect(client.call(routes.health)).rejects.toBeInstanceOf(ContractViolationError);
  });

  it('calls the versioned path on the configured origin', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(Response.json({ status: 'ok', checks: { database: 'ok' } })),
    );
    await createApiClient({ origin: 'https://api.arca.test', fetch }).call(routes.health);
    expect(fetch).toHaveBeenCalledWith('https://api.arca.test/v1/health', expect.anything());
  });
});

describe('errors', () => {
  it('returns only a generic code, never details', async () => {
    const { app } = setup(() => Promise.resolve('ok'));
    app.get('/v1/boom', () => {
      throw new Error('detail that must not leak');
    });
    const response = await app.request('/v1/boom');
    expect(response.status).toBe(500);
    expect(await response.text()).toBe(JSON.stringify({ error: { code: 'internal_error' } }));
  });

  it.each(['/v1/missing', '/internal/missing'])(
    'answers %s with not_found and no-store',
    async (path) => {
      const { app } = setup(() => Promise.resolve('ok'));
      const response = await app.request(path);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: 'not_found' } });
      expect(response.headers.get('cache-control')).toBe('no-store');
    },
  );
});
