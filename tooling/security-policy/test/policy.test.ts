import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from '../src/index.js';

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
