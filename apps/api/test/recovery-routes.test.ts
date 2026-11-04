import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RateLimitRule } from '../src/auth/rate-limit.js';
import type { Recovery, RecoveryRegistration, RedeemOutcome } from '../src/auth/recovery.js';
import type { Logger } from '../src/logger.js';
import { noLimits } from './limits.js';
import { attestation, creationOptions } from './passkey-fixtures.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const token = Buffer.alloc(32, 7).toString('base64url');
const code = '0123456789ABCDEFGHJKMNPQRS';
const registration = Buffer.alloc(32, 9).toString('base64url');

function setup({
  started = 'accepted',
  redeemed = { ok: true, code, token: registration },
  options = creationOptions,
  registered = 'registered',
  refusedRule,
}: {
  started?: 'accepted' | 'email_unavailable';
  redeemed?: RedeemOutcome;
  options?: typeof creationOptions | null;
  registered?: RecoveryRegistration;
  refusedRule?: string;
} = {}) {
  const calls: unknown[][] = [];
  const hits: { rule: string; subject: string }[] = [];
  const recovery: Recovery = {
    start: (email) => {
      calls.push(['start', email]);
      return Promise.resolve(started);
    },
    redeem: (...args) => {
      calls.push(['redeem', ...args]);
      return Promise.resolve(redeemed);
    },
    options: (...args) => {
      calls.push(['options', ...args]);
      return Promise.resolve(options);
    },
    verify: (...args) => {
      calls.push(['verify', ...args]);
      return Promise.resolve(registered);
    },
  };
  const app = createApp({
    accountsOpen: true,
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(null),
      refresh: () => Promise.resolve({ session: null, setCookies: [] }),
    },
    authLimits: {
      ...noLimits,
      limiter: {
        hit: (rule: RateLimitRule, subject: string) => {
          hits.push({ rule: rule.name, subject });
          return Promise.resolve(
            rule.name === refusedRule
              ? { allowed: false, retryAfterSeconds: 60 }
              : { allowed: true },
          );
        },
      },
    },
    recovery,
  });
  const post = (path: string, body: unknown) =>
    app.request(`/v1/auth/recovery/${path}`, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
      },
      body: JSON.stringify(body),
    });
  return { post, calls, hits };
}

describe('the recovery routes (spec 0003, R6)', () => {
  it('answers a start the same way, limited per address and per email', async () => {
    const { post, calls, hits } = setup();
    const response = await post('start', { email: 'Owner@Example.com' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(calls).toEqual([['start', 'Owner@Example.com']]);
    expect(hits).toEqual([
      { rule: 'recovery_start_ip', subject: '192.0.2.1' },
      { rule: 'recovery_start_email', subject: 'owner@example.com' },
    ]);
  });

  it('answers 429 over the email limit without starting', async () => {
    const { post, calls } = setup({ refusedRule: 'recovery_start_email' });
    const response = await post('start', { email: 'owner@example.com' });
    expect(response.status).toBe(429);
    expect(calls).toEqual([]);
  });

  it('answers 503 email_unavailable where no email can be sent', async () => {
    const response = await setup({ started: 'email_unavailable' }).post('start', {
      email: 'owner@example.com',
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'email_unavailable' } });
  });

  it('answers 400 to a start without an email address', async () => {
    const { post, calls } = setup();
    expect((await post('start', { email: 'nobody' })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('answers a redeemed link with the new code', async () => {
    const { post, calls } = setup();
    const response = await post('redeem', { token, code: 'abc' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code, token: registration });
    expect(calls).toEqual([['redeem', token, 'abc']]);
  });

  it.each([
    ['not_found', 404, 'not_found'],
    ['invalid_code', 403, 'invalid_code'],
    ['locked', 403, 'recovery_locked'],
  ] as const)('answers a %s redemption with %i', async (reason, status, errorCode) => {
    const response = await setup({ redeemed: { ok: false, reason } }).post('redeem', {
      token,
      code,
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code: errorCode } });
  });

  it('answers 429 over the redeem limit without redeeming', async () => {
    const { post, calls } = setup({ refusedRule: 'recovery_redeem_ip' });
    expect((await post('redeem', { token, code })).status).toBe(429);
    expect(calls).toEqual([]);
  });

  it('answers creation options for a redeemed link, 404 otherwise', async () => {
    const opened = await setup().post('options', { token });
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual(creationOptions);
    expect((await setup({ options: null }).post('options', { token })).status).toBe(404);
  });

  it('stores the passkey with the device it was made on', async () => {
    const { post, calls } = setup();
    const response = await post('verify', { token, response: attestation });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(calls).toEqual([['verify', token, attestation, { browser: 'firefox', os: 'linux' }]]);
  });

  it.each([
    ['refused', 403, 'passkey_refused'],
    ['not_found', 404, 'not_found'],
  ] as const)('answers a %s passkey with %i', async (registered, status, errorCode) => {
    const response = await setup({ registered }).post('verify', { token, response: attestation });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code: errorCode } });
  });

  it('sets no session cookie', async () => {
    const response = await setup().post('verify', { token, response: attestation });
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
