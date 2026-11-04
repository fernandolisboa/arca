import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { securityContact } from '../src/security-txt.js';

const day = 24 * 60 * 60 * 1000;

describe('/.well-known/security.txt (spec 0004, R11)', () => {
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok' as const),
    logger: { info: () => undefined, error: () => undefined },
  });

  it('names the private vulnerability reporting, its expiry and languages', async () => {
    const response = await app.request('/.well-known/security.txt');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=UTF-8');
    expect(await response.text()).toBe(
      [
        'Contact: https://github.com/fernandolisboa/arca/security/advisories/new',
        `Expires: ${securityContact.expires}`,
        'Preferred-Languages: pt-BR, en',
        'Policy: https://github.com/fernandolisboa/arca/blob/main/SECURITY.md',
        'Canonical: https://arca.filx.app/.well-known/security.txt',
        '',
      ].join('\n'),
    );
  });

  it('is renewed at least 30 days before it expires, and never set more than a year ahead', () => {
    const left = Date.parse(securityContact.expires) - Date.now();
    expect(left, 'renew Expires in apps/api/src/security-txt.ts').toBeGreaterThan(30 * day);
    expect(left).toBeLessThanOrEqual(366 * day);
  });
});
