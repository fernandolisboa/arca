import { securityHeaders } from '@arca/security-policy';
import { describe, expect, it } from 'vitest';
import { smokeTest } from '../src/smoke.ts';

const origin = new URL('https://arca.example');
const healthy = { body: { status: 'ok', checks: { database: 'ok' } } };
const now = new Date('2026-11-04T12:00:00Z');
const securityTxt = (expires: string) =>
  `Contact: https://github.com/fernandolisboa/arca/security/advisories/new\nExpires: ${expires}\n`;

interface Answer {
  readonly status?: number;
  readonly body?: unknown;
  readonly raw?: string;
  readonly contentType?: string;
}

/**
 * Answers `/v1/health` with each of `health` in turn, repeating the last, `/` with `page`, the
 * workflow runner with `runnerStatus` and its webhook with `webhookStatus`.
 */
function fakeFetch(
  health: readonly Answer[],
  {
    page = {},
    runnerStatus = 404,
    webhookStatus = 404,
    headers = securityHeaders,
    contact = { raw: securityTxt('2027-11-04T00:00:00.000Z') },
  }: {
    page?: Answer;
    runnerStatus?: number;
    webhookStatus?: number;
    headers?: Record<string, string>;
    contact?: Answer;
  } = {},
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
    if (path === '/.well-known/security.txt') {
      return Promise.resolve(
        new Response(contact.raw ?? '', {
          status: contact.status ?? 200,
          headers: { 'content-type': 'text/plain; charset=UTF-8' },
        }),
      );
    }
    if (path === '/.well-known/workflow/v1/flow') {
      return Promise.resolve(new Response(null, { status: runnerStatus }));
    }
    if (path.startsWith('/.well-known/workflow/v1/webhook/')) {
      return Promise.resolve(new Response(null, { status: webhookStatus }));
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
  smokeTest(origin, { fetchUrl: fake.fetchUrl, attempts: 3, retryDelayMs: 0, now: () => now });

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

  it('fails without throwing when a request fails', async () => {
    const fetchUrl: typeof fetch = () => Promise.reject(new TypeError('fetch failed'));
    expect(await smokeTest(origin, { fetchUrl, attempts: 2, retryDelayMs: 0 })).toEqual([
      { where: '/v1/health', problem: 'request failed: TypeError' },
      { where: '/', problem: 'request failed: TypeError' },
      { where: '/.well-known/workflow/v1/flow', problem: 'request failed: TypeError' },
      { where: '/.well-known/workflow/v1/webhook/', problem: 'request failed: TypeError' },
      { where: '/.well-known/security.txt', problem: 'request failed: TypeError' },
    ]);
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

  it.each([401, 403, 404])('accepts a runner that the platform closes with %i', async (status) => {
    expect(await run(fakeFetch([healthy], { runnerStatus: status }))).toEqual([]);
  });

  it.each([200, 202, 400, 500])(
    'fails when an unsigned request reaches the runner and gets %i',
    async (status) => {
      expect(await run(fakeFetch([healthy], { runnerStatus: status }))).toEqual([
        {
          where: '/.well-known/workflow/v1/flow',
          problem: `answered ${String(status)} to an unsigned request`,
        },
      ]);
    },
  );

  it.each([401, 403, 404])(
    'accepts a webhook that refuses an unknown token with %i',
    async (status) => {
      expect(await run(fakeFetch([healthy], { webhookStatus: status }))).toEqual([]);
    },
  );

  it.each([200, 202, 302, 400, 500])(
    'fails when the workflow webhook answers %i to an unknown token',
    async (status) => {
      expect(await run(fakeFetch([healthy], { webhookStatus: status }))).toEqual([
        {
          where: '/.well-known/workflow/v1/webhook/',
          problem: `answered ${String(status)} to an unknown token`,
        },
      ]);
    },
  );

  it.each<[string, Answer, string]>([
    [
      'is 30 days from expiry',
      { raw: securityTxt('2026-12-04T12:00:00Z') },
      'expires in 30 days; renew Expires',
    ],
    [
      'has expired',
      { raw: securityTxt('2026-11-01T00:00:00Z') },
      'expires in -4 days; renew Expires',
    ],
    ['has no Expires', { raw: 'Contact: https://example.com/report\n' }, 'has no valid Expires'],
    ['has a loose Expires', { raw: securityTxt('Nov 4 2027') }, 'has no valid Expires'],
    [
      'has no https Contact',
      { raw: 'Contact: mailto:x@example.com\nExpires: 2027-11-04T00:00:00Z\n' },
      'names no https Contact',
    ],
    ['is missing', { status: 404 }, 'answered 404'],
  ])('fails when security.txt %s', async (_label, contact, problem) => {
    expect(await run(fakeFetch([healthy], { contact }))).toEqual([
      { where: '/.well-known/security.txt', problem },
    ]);
  });
});
