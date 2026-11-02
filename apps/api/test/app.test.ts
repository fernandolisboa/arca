import { createApiClient, ContractViolationError, routes } from '@arca/api-contract/client';
import { HealthResponse } from '@arca/api-contract/routes';
import { createRoute, z } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';
import { createApp, createRouter } from '../src/app.js';
import type { CheckDatabase } from '../src/database-health.js';
import { createLogger, type Logger } from '../src/logger.js';

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

  it.each<[string, CheckDatabase]>([
    ['rejects', () => Promise.reject(new Error('connection refused'))],
    [
      'throws synchronously',
      () => {
        throw new Error('bad configuration');
      },
    ],
  ])('reports unavailable when the check %s', async (_label, check) => {
    const { client } = setup(check);
    await expect(client.call(routes.health)).resolves.toEqual({
      status: 'degraded',
      checks: { database: 'unavailable' },
    });
  });

  it('reports unavailable when the check takes longer than 2 seconds', async () => {
    vi.useFakeTimers();
    try {
      const { client } = setup(() => new Promise(() => undefined));
      const result = client.call(routes.health);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(result).resolves.toEqual({
        status: 'degraded',
        checks: { database: 'unavailable' },
      });
    } finally {
      vi.useRealTimers();
    }
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
  /** Mounts extra routes the way real route modules will, on routers under /v1 and /internal. */
  function withProbeRoutes(lines: string[] = []) {
    const logger = createLogger((line) => lines.push(line));
    const probed = createApp({ checkDatabase: () => Promise.resolve('ok'), logger, now: () => 0 });
    const v1 = createRouter();
    v1.openapi(
      createRoute({
        method: 'get',
        path: '/echo',
        request: { query: z.object({ n: z.coerce.number().int() }) },
        responses: { 200: { description: 'ok' } },
      }),
      (c) => c.json({ n: c.req.valid('query').n }, 200),
    );
    v1.get('/boom', () => {
      throw new TypeError('detail that must not leak');
    });
    v1.get('/odd', () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- third-party code can throw anything
      throw { detail: 'person@example.test' };
    });
    const internal = createRouter();
    internal.get('/ping', (c) => c.text('pong'));
    probed.route('/v1', v1);
    probed.route('/internal', internal);
    return probed;
  }

  it('answers a validation failure with invalid_request and no validator details', async () => {
    const response = await withProbeRoutes().request('/v1/echo?n=abc');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'invalid_request' } });
  });

  it.each(['/v1/boom', '/v1/odd'])(
    'answers %s with internal_error only, logging the error class but not its detail',
    async (path) => {
      const lines: string[] = [];
      const response = await withProbeRoutes(lines).request(path);
      expect(response.status).toBe(500);
      expect(await response.text()).toBe(JSON.stringify({ error: { code: 'internal_error' } }));
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-request-id')).not.toBeNull();
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toMatch(/detail|person/);
      expect(JSON.parse(lines[0] ?? '')).toMatchObject({
        level: 'error',
        status: 500,
        errorCode: 'internal_error',
        errorName: path === '/v1/boom' ? 'TypeError' : 'NonErrorThrown',
      });
    },
  );

  it('logs the route pattern, never the request path or query', async () => {
    const lines: string[] = [];
    await withProbeRoutes(lines).request('/v1/echo?n=1&email=someone@example.test');
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ route: '/v1/echo', status: 200 });
    expect(lines[0]).not.toContain('example.test');
  });

  it('marks successful /internal responses no-store', async () => {
    const response = await withProbeRoutes().request('/internal/ping');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
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

describe('GET /internal/cron/heartbeat (spec 0001, R6)', () => {
  const secret = 'cron-secret-for-tests';

  function cronSetup(readSecret: () => string = () => secret) {
    const started: string[] = [];
    const app = createApp({
      checkDatabase: () => Promise.resolve('ok'),
      logger: silentLogger,
      cron: {
        readSecret,
        startHeartbeat: (runDate) => {
          started.push(runDate);
          return Promise.resolve('wrun_test');
        },
        clock: () => new Date('2026-11-02T23:30:00.000-03:00'),
      },
    });
    const call = (authorization?: string) =>
      app.request('/internal/cron/heartbeat', {
        headers: authorization === undefined ? {} : { authorization },
      });
    return { app, call, started };
  }

  it('starts the heartbeat for the UTC date and answers 202', async () => {
    const { call, started } = cronSetup();
    const response = await call(`Bearer ${secret}`);
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
    expect(started).toEqual(['2026-11-03']);
  });

  it.each([
    ['no token', undefined],
    ['a wrong token', `Bearer ${'x'.repeat(secret.length)}`],
    ['a token of another length', 'Bearer short'],
  ])('answers 401 to %s and starts nothing', async (_label, authorization) => {
    const { call, started } = cronSetup();
    const response = await call(authorization);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'unauthorized' } });
    expect(started).toEqual([]);
  });

  it('fails closed when the secret is not configured', async () => {
    const { call, started } = cronSetup(() => {
      throw new Error('CRON_SECRET is not set');
    });
    const response = await call(`Bearer ${secret}`);
    expect(response.status).toBe(500);
    expect(started).toEqual([]);
  });

  it('is not served without the cron dependencies', async () => {
    const { app } = setup(() => Promise.resolve('ok'));
    const response = await app.request('/internal/cron/heartbeat', {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(response.status).toBe(404);
  });

  it('only answers GET', async () => {
    const { app, started } = cronSetup();
    const response = await app.request('/internal/cron/heartbeat', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(response.status).toBe(404);
    expect(started).toEqual([]);
  });
});
