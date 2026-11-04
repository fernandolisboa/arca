import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('client entry', () => {
  it('never probes `new Function`, which the strict CSP reports, while it builds schemas', async () => {
    const probe = vi.spyOn(globalThis, 'Function');
    const { routes } = await import('../src/client/index.js');
    expect(
      routes.health.response.schema.parse({
        status: 'ok',
        checks: { database: 'ok' },
        accounts: 'open',
      }),
    ).toEqual({ status: 'ok', checks: { database: 'ok' }, accounts: 'open' });
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('withHeaders', () => {
  it('adds headers to every request without dropping the content type', async () => {
    const { createApiClient, routes } = await import('../src/client/index.js');
    const sent: Headers[] = [];
    const client = createApiClient({
      origin: 'https://arca.test',
      fetch: (_, init) => {
        sent.push(new Headers(init?.headers));
        return Promise.resolve(Response.json({ code: '0'.repeat(26) }));
      },
    });
    await client
      .withHeaders({ 'arca-step-up-nonce': 'MzMzMzMzMzMzMzMzMzMzMw' })
      .call(routes.regenerateRecoveryKit, {});
    expect(sent[0]?.get('arca-step-up-nonce')).toBe('MzMzMzMzMzMzMzMzMzMzMw');
    expect(sent[0]?.get('content-type')).toBe('application/json');
  });
});
