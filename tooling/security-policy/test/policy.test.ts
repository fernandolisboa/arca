import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, isUnpublishedFile, securityHeaders } from '../src/index.js';

describe('securityHeaders', () => {
  it('matches spec 0001, R4, reporting violations as spec 0004, R5 asks', () => {
    expect(contentSecurityPolicy).toBe(
      "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types arca; report-to csp",
    );
    expect(securityHeaders).toEqual({
      'content-security-policy': contentSecurityPolicy,
      'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'reporting-endpoints': 'csp="/internal/monitoring/csp"',
    });
  });
});

describe('isUnpublishedFile', () => {
  it.each(['.tsbuildinfo', 'assets/index-abc.js.map', 'icons/.DS_Store', '.well-known/x'])(
    'leaves out %s',
    (path) => {
      expect(isUnpublishedFile(path)).toBe(true);
    },
  );

  it.each(['index.html', 'assets/index-abc.js', 'icons/icon-192.png', 'manifest.webmanifest'])(
    'publishes %s',
    (path) => {
      expect(isUnpublishedFile(path)).toBe(false);
    },
  );
});
