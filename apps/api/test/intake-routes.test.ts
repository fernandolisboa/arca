import type { Logger } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { SignedIn } from '../src/auth/service.js';
import type { CaseFiles } from '../src/case/case-files.js';
import type { CaseIntake, CaseIntakeOutcome } from '../src/case/intake.js';
import { noLimits } from './limits.js';

// The intake route with a fake service (spec 0008, R3). Synthetic text only.
const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const owner: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const session = {
  accountId: owner.accountId,
  email: 'owner@example.com',
  confirmed: true,
  device: { browser: 'firefox' as const, os: 'linux' as const },
};
const me = '0b9c3d6e-1f2a-4b5c-8d7e-9f0a1b2c3d4e';
const value = {
  draft: {
    people: [
      { ref: me, birthDate: '1985' },
      { ref: 'n1', role: 'child' },
    ],
    relationships: [],
  },
  sentences: [{ kind: 'born', question: 'birthDate', about: [me], person: me, date: '1985' }],
};

function setup({
  outcome = { ok: true, value } as CaseIntakeOutcome,
  withIntake = true,
  blocked = '',
  confirmedAccount = true,
}: {
  outcome?: CaseIntakeOutcome;
  withIntake?: boolean;
  blocked?: string;
  confirmedAccount?: boolean;
} = {}) {
  const drafts: [string, string][] = [];
  const limited: [string, string][] = [];
  const intake: CaseIntake = {
    draft: (accountId, text) => {
      drafts.push([accountId, text]);
      return Promise.resolve(outcome);
    },
  };
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(owner),
      refresh: () => Promise.resolve({ session, setCookies: [] }),
    },
    authLimits: {
      ...noLimits,
      limiter: {
        hit: (rule, subject) => {
          limited.push([rule.name, subject]);
          return Promise.resolve(
            rule.name === blocked ? { allowed: false, retryAfterSeconds: 60 } : { allowed: true },
          );
        },
      },
    },
    cases: {} as CaseFiles,
    accountConfirmed: () => Promise.resolve(confirmedAccount),
    ...(withIntake ? { intake } : {}),
  });
  const post = (body: unknown) =>
    app.request('/v1/case/intake/draft', {
      method: 'POST',
      headers: { origin, cookie: 'session=1', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { post, drafts, limited };
}

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('the intake route (spec 0008, R3)', () => {
  it('drafts the viewer’s text under the per-minute and per-day limits', async () => {
    const { post, drafts, limited } = setup();
    const response = await post({ text: '  Nasci em 1985 e tenho uma filha.  ' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(value);
    expect(drafts).toEqual([[owner.accountId, 'Nasci em 1985 e tenho uma filha.']]);
    expect(limited).toEqual([
      ['case_intake_minute', owner.accountId],
      ['case_intake_day', owner.accountId],
    ]);
  });

  it.each([
    ['not_found', 404],
    ['intake_unparsable', 502],
    ['intake_failed', 502],
    ['intake_unavailable', 503],
    ['intake_timeout', 504],
  ] as const)('answers %s as %i', async (reason, status) => {
    const response = await setup({ outcome: { ok: false, reason } }).post({
      text: 'Nasci em 1985.',
    });
    expect(response.status).toBe(status);
    expect(await errorOf(response)).toBe(reason);
  });

  it('answers 503 when the deployment has no extractor, before counting', async () => {
    const { post, limited } = setup({ withIntake: false });
    const response = await post({ text: 'Nasci em 1985.' });
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe('intake_unavailable');
    expect(limited).toEqual([]);
  });

  it.each(['case_intake_minute', 'case_intake_day'])(
    'stops at the %s limit without calling the model',
    async (blocked) => {
      const { post, drafts } = setup({ blocked });
      const response = await post({ text: 'Nasci em 1985.' });
      expect(response.status).toBe(429);
      expect(drafts).toEqual([]);
    },
  );

  it.each([
    ['an empty text', { text: '   ' }],
    ['a text over 4,000 characters', { text: 'a'.repeat(4_001) }],
    ['an unknown field', { text: 'Nasci em 1985.', model: 'other' }],
    ['a text that normalizing makes too long', { text: '\uFDFA'.repeat(300) }],
  ])('refuses %s', async (_, body) => {
    const { post, drafts } = setup();
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(drafts).toEqual([]);
  });

  it('refuses an unconfirmed account', async () => {
    const { post, drafts } = setup({ confirmedAccount: false });
    const response = await post({ text: 'Nasci em 1985.' });
    expect(response.status).toBe(403);
    expect(drafts).toEqual([]);
  });
});
