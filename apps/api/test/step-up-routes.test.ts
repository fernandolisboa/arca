import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RateLimitRule } from '../src/auth/rate-limit.js';
import type { SignedIn, StepUpService } from '../src/auth/step-up.js';
import type { Logger } from '../src/logger.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const owner: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const challengeId = '0b8f6c2e-1d3a-4e5f-8a7b-9c0d1e2f3a4b';

const target = {
  action: 'revokeSession',
  targets: ['5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a'],
  nonce: 'MzMzMzMzMzMzMzMzMzMzMw',
};
const assertion = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
  clientExtensionResults: {},
};

function setup({
  signedIn = owner,
  allowed = true,
  verified = true,
}: { signedIn?: SignedIn | null; allowed?: boolean; verified?: boolean } = {}) {
  const calls: string[] = [];
  const hits: { rule: RateLimitRule; subject: string }[] = [];
  const stepUp: StepUpService = {
    options: (current, request) => {
      calls.push(`options ${current.sessionId} ${request.purpose}`);
      return Promise.resolve({
        challengeId,
        options: { challenge: 'Y2hhbGxlbmdl', userVerification: 'required' },
      });
    },
    verify: (current, id) => {
      calls.push(`verify ${current.sessionId} ${id}`);
      return Promise.resolve(verified);
    },
    consume: () => Promise.resolve(false),
    vaultUnlocked: () => Promise.resolve(false),
  };
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(signedIn),
      refresh: () => Promise.resolve({ session: null, setCookies: [] }),
    },
    authLimits: {
      limiter: {
        hit: (rule, subject) => {
          hits.push({ rule, subject });
          return Promise.resolve(allowed ? { allowed } : { allowed, retryAfterSeconds: 60 });
        },
      },
      clientAddress: () => '198.51.100.7',
    },
    stepUp,
  });
  const post = (path: string, body: unknown, headers: Record<string, string> = { origin }) =>
    app.request(`/v1/auth/step-up/${path}`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { post, calls, hits };
}

describe('the step-up routes (spec 0003, R5)', () => {
  it('issues options for the signed-in session, counted against its own limit', async () => {
    const { post, calls, hits } = setup();
    const response = await post('options', { purpose: 'sensitive_settings', target });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ challengeId });
    expect(calls).toEqual([`options ${owner.sessionId} sensitive_settings`]);
    expect(hits.map(({ rule, subject }) => [rule.name, subject])).toEqual([
      ['step_up_options_session', owner.sessionId],
    ]);
  });

  it('answers 200 to a verified step-up and 401 to any refused one', async () => {
    const accepted = setup();
    const ok = await accepted.post('verify', { challengeId, response: assertion });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({});
    expect(accepted.hits.map(({ rule }) => rule.name)).toEqual(['step_up_verify_session']);
    const refused = setup({ verified: false });
    const no = await refused.post('verify', { challengeId, response: assertion });
    expect(no.status).toBe(401);
    expect(await no.json()).toEqual({ error: { code: 'unauthorized' } });
  });

  it.each(['options', 'verify'])('answers 401 to %s without a session', async (path) => {
    const { post, calls, hits } = setup({ signedIn: null });
    const body =
      path === 'options' ? { purpose: 'vault_unlock' } : { challengeId, response: assertion };
    expect((await post(path, body)).status).toBe(401);
    expect(calls).toEqual([]);
    expect(hits).toEqual([]);
  });

  it.each(['options', 'verify'])('answers 429 to %s over the session limit', async (path) => {
    const { post, calls } = setup({ allowed: false });
    const body =
      path === 'options' ? { purpose: 'vault_unlock' } : { challengeId, response: assertion };
    const response = await post(path, body);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(calls).toEqual([]);
  });

  it.each([
    ['a subject for vault_unlock', { purpose: 'vault_unlock', target }],
    ['no subject for another purpose', { purpose: 'account_deletion' }],
    ['a purpose outside the enum', { purpose: 'knowledge_review', target }],
  ])('answers 400 to options with %s', async (_, body) => {
    const { post, calls } = setup();
    expect((await post('options', body)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('refuses a step-up from another site', async () => {
    const { post, calls } = setup();
    const response = await post(
      'verify',
      { challengeId, response: assertion },
      {
        origin: 'https://other.filx.app',
      },
    );
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });
});
