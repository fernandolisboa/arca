import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, isFallbackExcluded, securityHeaders } from '../src/index.js';

describe('securityHeaders', () => {
  it('matches spec 0001, R4', () => {
    expect(contentSecurityPolicy).toBe(
      "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types arca",
    );
    expect(securityHeaders).toEqual({
      'content-security-policy': contentSecurityPolicy,
      'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    });
  });
});

describe('isFallbackExcluded', () => {
  it.each([
    '/v1',
    '/v1/',
    '/v1/health',
    '/internal',
    '/internal/cron/heartbeat',
    '/.well-known',
    '/.well-known/workflow/v1/flow',
  ])('excludes %s', (path) => {
    expect(isFallbackExcluded(path)).toBe(true);
  });

  it.each(['/', '/casos', '/v10', '/v1x/health', '/internals', '/.well-knownx', '/assets/app.js'])(
    'falls back for %s',
    (path) => {
      expect(isFallbackExcluded(path)).toBe(false);
    },
  );
});
