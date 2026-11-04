import { describe, expect, it } from 'vitest';
import { clientAddressFor, rateLimitSubject } from '../src/client-address.js';

describe('the client address for rate limits (spec 0003, R10)', () => {
  it("reads Vercel's own header on a deployment, first entry only", () => {
    const address = clientAddressFor('production', () => undefined);
    expect(address(new Headers({ 'x-vercel-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe(
      '203.0.113.9',
    );
  });

  it('reads only x-vercel-forwarded-for, and reports the shared fallback', () => {
    let unknown = 0;
    const address = clientAddressFor('preview', () => {
      unknown += 1;
    });
    expect(address(new Headers({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '1.2.3.4' }))).toBe(
      'unknown',
    );
    expect(address(new Headers({ 'x-vercel-forwarded-for': 'not an address' }))).toBe('unknown');
    expect(unknown).toBe(2);
  });

  it('counts every local request as one client', () => {
    const address = clientAddressFor('development', () => undefined);
    expect(address(new Headers({ 'x-vercel-forwarded-for': '1.2.3.4' }))).toBe('local');
  });

  it.each([
    ['198.51.100.7', '198.51.100.7'],
    ['::ffff:198.51.100.7', '198.51.100.7'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::9', '2001:db8:1:2::/64'],
    ['2001:DB8:0001:0002:ffff::1', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
  ])('counts %s as %s', (address, subject) => {
    expect(rateLimitSubject(address)).toBe(subject);
  });

  it('gives one counter to every address in an IPv6 /64', () => {
    expect(rateLimitSubject('2001:db8:1:2::a')).toBe(rateLimitSubject('2001:db8:1:2:ffff::b'));
  });
});
