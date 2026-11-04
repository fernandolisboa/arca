import { describe, expect, it } from 'vitest';
import { routes, type RouteDefinition } from '../src/routes/index.js';

const all: readonly RouteDefinition[] = Object.values(routes);

describe('link tokens (spec 0003, R2)', () => {
  it.each(all.map((route) => [route.operationId, route] as const))(
    '%s takes no token in its path or query',
    (_, route) => {
      expect(route.path).not.toMatch(/[{:]/);
      expect(
        Object.keys(route.query?.shape ?? {}).filter((key) => /token|code/i.test(key)),
      ).toEqual([]);
    },
  );

  it('carries the registration and invite tokens in a POST body', () => {
    for (const route of [
      routes.registrationOptions,
      routes.registrationVerify,
      routes.inviteDetails,
    ]) {
      expect(route.method).toBe('post');
      expect(route.body.shape.token.safeParse('A'.repeat(43)).success).toBe(true);
      expect(route.body.shape.token.safeParse('A'.repeat(42).concat('B')).success).toBe(false);
    }
  });
});
