import { securityHeaders } from '@arca/security-policy';
import { describe, expect, it } from 'vitest';
import { smokeTest } from '../src/smoke.ts';

const origin = new URL('https://arca.example');
const healthy = { body: { status: 'ok', checks: { database: 'ok' } } };

interface Answer {
  readonly status?: number;
  readonly body?: unknown;
  readonly raw?: string;
  readonly contentType?: string;
}

/** Answers `/v1/health` with each of `health` in turn, repeating the last, and `/` with `page`. */
function fakeFetch(
  health: readonly Answer[],
  {
    page = {},
    headers = securityHeaders,
  }: { page?: Answer; headers?: Record<string, string> } = {},
): { fetchUrl: typeof fetch; healthCalls: () => number } {
  let calls = 0;
  const fetchUrl: typeof fetch = (input) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    if (path === '/v1/health') {
      const answer = health[Math.min(calls, health.length - 1)] ?? {};
      calls += 1;
      return Promise.resolve(
        new Response(answer.raw ?? JSON.stringify(answer.body), {
          status: answer.status ?? 200,
          headers: { ...headers, 'content-type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(
      new Response('<!doctype html>', {
        status: page.status ?? 200,
        headers: { ...headers, 'content-type': page.contentType ?? 'text/html; charset=utf-8' },
      }),
    );
  };
  return { fetchUrl, healthCalls: () => calls };
}

const run = (fake: ReturnType<typeof fakeFetch>) =>
  smokeTest(origin, { fetchUrl: fake.fetchUrl, attempts: 3, retryDelayMs: 0 });

describe('production smoke test (spec 0001, R9)', () => {
  it('passes with a healthy database, the web app and every security header', async () => {
    expect(await run(fakeFetch([healthy]))).toEqual([]);
  });

  it('retries the health check until the database answers', async () => {
    const fake = fakeFetch([
      { body: { status: 'degraded', checks: { database: 'unavailable' } } },
      healthy,
    ]);
    expect(await run(fake)).toEqual([]);
    expect(fake.healthCalls()).toBe(2);
  });

  it.each<[string, Answer]>([
    ['a degraded service', { body: { status: 'degraded', checks: { database: 'unavailable' } } }],
    [
      'the wrong database role',
      { body: { status: 'degraded', checks: { database: 'wrong_role' } } },
    ],
    ['an ok status with the database down', { body: { status: 'ok', checks: { database: 'no' } } }],
    ['a redirect to a login page', { status: 302, body: {} }],
    ['an unexpected body', { body: 'ok' }],
    ['a body that is not JSON', { raw: '<!doctype html>' }],
  ])('fails on %s after every attempt', async (_label, health) => {
    const fake = fakeFetch([health]);
    const violations = await run(fake);
    expect(violations.map((violation) => violation.where)).toEqual(['/v1/health']);
    expect(fake.healthCalls()).toBe(3);
  });

  it.each<[string, Answer]>([
    ['an error page', { status: 500 }],
    ['a page that is not HTML', { contentType: 'application/json' }],
  ])('fails when the web app answers with %s', async (_label, page) => {
    const violations = await run(fakeFetch([healthy], { page }));
    expect(violations.map((violation) => violation.where)).toEqual(['/']);
  });

  it('fails when a security header is missing or differs', async () => {
    const rest = Object.fromEntries(
      Object.entries(securityHeaders).filter(([name]) => name !== 'content-security-policy'),
    );
    const violations = await run(
      fakeFetch([healthy], { headers: { ...rest, 'referrer-policy': 'origin' } }),
    );
    expect(violations).toEqual(
      ['/', '/v1/health'].flatMap((where) => [
        { where, problem: 'header content-security-policy is missing or differs' },
        { where, problem: 'header referrer-policy is missing or differs' },
      ]),
    );
  });
});
