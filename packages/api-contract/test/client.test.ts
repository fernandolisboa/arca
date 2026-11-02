import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('client entry', () => {
  it('never probes `new Function`, which the strict CSP reports, while it builds schemas', async () => {
    const probe = vi.spyOn(globalThis, 'Function');
    const { routes } = await import('../src/client/index.js');
    expect(
      routes.health.response.schema.parse({ status: 'ok', checks: { database: 'ok' } }),
    ).toEqual({ status: 'ok', checks: { database: 'ok' } });
    expect(probe).not.toHaveBeenCalled();
  });
});
