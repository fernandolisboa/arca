import { globalConfig } from 'zod/v4/core';
import { describe, expect, it } from 'vitest';
import { routes } from '../src/client/index.js';

describe('client entry', () => {
  it('turns off Zod JIT before any schema is built, for the strict CSP', () => {
    expect(globalConfig.jitless).toBe(true);
    expect(
      routes.health.response.schema.parse({ status: 'ok', checks: { database: 'ok' } }),
    ).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });
});
