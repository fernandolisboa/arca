import type { Logger } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { SignedIn } from '../src/auth/service.js';
import type { CaseFiles } from '../src/case/case-files.js';
import type {
  CriterionSuggestions,
  SuggestionOutcome,
} from '../src/case/suggestion/suggestions.js';
import { knownCriterionNames } from '../src/case/suggestion/known.js';
import { noLimits } from './limits.js';

// The criterion suggestion route with a fake service. Catalog names only.
const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const member: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const value = { suggestions: [{ name: 'Custo de creche', weight: 2 }] };

function setup({
  outcome = { ok: true, value },
  withSuggestions = true,
  blocked = '',
  confirmedAccount = true,
}: {
  outcome?: SuggestionOutcome;
  withSuggestions?: boolean;
  blocked?: string;
  confirmedAccount?: boolean;
} = {}) {
  const asked: (readonly string[])[] = [];
  const limited: [string, string][] = [];
  const criterionSuggestions: CriterionSuggestions = {
    suggest: (known) => {
      asked.push(known);
      return Promise.resolve(outcome);
    },
  };
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(member),
      refresh: () => Promise.resolve({ session: null, setCookies: [] }),
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
    ...(withSuggestions ? { criterionSuggestions } : {}),
  });
  const post = (body: unknown) =>
    app.request('/v1/comparison/suggestions', {
      method: 'POST',
      headers: { origin, cookie: 'session=1', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { post, asked, limited };
}

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('the criterion suggestion route', () => {
  it('sends the catalog’s names alone, under the per-minute and per-day limits', async () => {
    const { post, asked, limited } = setup();
    const response = await post({});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(value);
    expect(asked).toEqual([knownCriterionNames]);
    expect(knownCriterionNames).toContain('Clima');
    expect(knownCriterionNames).toContain('Voo direto para o Brasil');
    expect(limited).toEqual([
      ['criterion_suggestions_minute', member.accountId],
      ['criterion_suggestions_day', member.accountId],
    ]);
  });

  it.each([
    ['suggestions_unparsable', 502],
    ['suggestions_failed', 502],
    ['suggestions_unavailable', 503],
    ['suggestions_timeout', 504],
  ] as const)('answers %s as %i', async (reason, status) => {
    const response = await setup({ outcome: { ok: false, reason } }).post({});
    expect(response.status).toBe(status);
    expect(await errorOf(response)).toBe(reason);
  });

  it('answers 503 when the deployment has no suggester, before counting', async () => {
    const { post, limited } = setup({ withSuggestions: false });
    const response = await post({});
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe('suggestions_unavailable');
    expect(limited).toEqual([]);
  });

  it.each(['criterion_suggestions_minute', 'criterion_suggestions_day'])(
    'stops at the %s limit without calling the model',
    async (blocked) => {
      const { post, asked } = setup({ blocked });
      const response = await post({});
      expect(response.status).toBe(429);
      expect(asked).toEqual([]);
    },
  );

  it('refuses a body with anything in it, so no typed text reaches the model', async () => {
    const { post, asked } = setup();
    const response = await post({ known: ['Perto da praia'] });
    expect(response.status).toBe(400);
    expect(asked).toEqual([]);
  });

  it('refuses an unconfirmed account', async () => {
    const { post, asked } = setup({ confirmedAccount: false });
    expect((await post({})).status).toBe(403);
    expect(asked).toEqual([]);
  });
});
