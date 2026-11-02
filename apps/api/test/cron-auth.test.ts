import { describe, expect, it } from 'vitest';
import { bearerMatches } from '../src/cron-auth.js';

const secret = 'cron-secret-for-tests';

describe('bearerMatches', () => {
  it('accepts the exact bearer token', () => {
    expect(bearerMatches(`Bearer ${secret}`, secret)).toBe(true);
  });

  it.each([
    ['no header', undefined],
    ['an empty header', ''],
    ['the secret without the scheme', secret],
    ['another scheme', `Basic ${secret}`],
    ['a lowercase scheme', `bearer ${secret}`],
    ['a wrong secret of the same length', `Bearer ${'x'.repeat(secret.length)}`],
    ['a shorter secret', `Bearer ${secret.slice(0, -1)}`],
    ['a longer secret', `Bearer ${secret}x`],
    ['trailing whitespace', `Bearer ${secret} `],
  ])('refuses %s', (_label, header) => {
    expect(bearerMatches(header, secret)).toBe(false);
  });

  it('refuses everything when the secret is empty', () => {
    expect(bearerMatches('Bearer ', '')).toBe(false);
    expect(bearerMatches(undefined, '')).toBe(false);
  });
});
