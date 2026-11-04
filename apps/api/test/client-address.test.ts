import { describe, expect, it } from 'vitest';
import { clientAddressFor } from '../src/client-address.js';

describe('the client address for rate limits (spec 0003, R10)', () => {
  it("reads Vercel's own header on a deployment, first entry only", () => {
    const address = clientAddressFor('production');
    expect(address(new Headers({ 'x-vercel-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe(
      '203.0.113.9',
    );
  });

  it('ignores the spoofable headers a client may send', () => {
    const address = clientAddressFor('preview');
    expect(address(new Headers({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '1.2.3.4' }))).toBe(
      'unknown',
    );
  });

  it('counts every local request as one client', () => {
    expect(
      clientAddressFor('development')(new Headers({ 'x-vercel-forwarded-for': '1.2.3.4' })),
    ).toBe('local');
  });
});
