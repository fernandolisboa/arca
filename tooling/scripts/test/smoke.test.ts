import { securityHeaders } from '@arca/security-policy';
import { describe, expect, it } from 'vitest';
import { smokeTest } from '../src/smoke.ts';

const origin = new URL('https://arca.example');

function fakeFetch(
  health: { status?: number; body?: unknown },
  headers: Record<string, string> = securityHeaders,
): typeof fetch {
  return (input) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const body = path === '/v1/health' ? JSON.stringify(health.body) : '<!doctype html>';
    const status = path === '/v1/health' ? (health.status ?? 200) : 200;
    return Promise.resolve(new Response(body, { status, headers }));
  };
}

describe('production smoke test (spec 0001, R9)', () => {
  it('passes with a healthy database and every security header', async () => {
    expect(
      await smokeTest(origin, fakeFetch({ body: { status: 'ok', checks: { database: 'ok' } } })),
    ).toEqual([]);
  });

  it.each([
    ['a degraded service', { body: { status: 'degraded', checks: { database: 'unavailable' } } }],
    [
      'the wrong database role',
      { body: { status: 'degraded', checks: { database: 'wrong_role' } } },
    ],
    ['a redirect to a login page', { status: 302, body: {} }],
    ['an unexpected body', { body: 'ok' }],
  ])('fails on %s', async (_label, health) => {
    const violations = await smokeTest(origin, fakeFetch(health));
    expect(violations.map((violation) => violation.where)).toContain('/v1/health');
  });

  it('fails when a security header is missing or differs', async () => {
    const rest = Object.fromEntries(
      Object.entries(securityHeaders).filter(([name]) => name !== 'content-security-policy'),
    );
    const violations = await smokeTest(
      origin,
      fakeFetch(
        { body: { status: 'ok', checks: { database: 'ok' } } },
        { ...rest, 'referrer-policy': 'origin' },
      ),
    );
    expect(violations).toEqual(
      ['/', '/v1/health'].flatMap((where) => [
        { where, problem: 'header content-security-policy is missing or differs' },
        { where, problem: 'header referrer-policy is missing or differs' },
      ]),
    );
  });
});
