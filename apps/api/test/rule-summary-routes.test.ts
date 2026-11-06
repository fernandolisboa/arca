import type { Logger } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { SignedIn } from '../src/auth/service.js';
import type { KnowledgeDecisions } from '../src/knowledge/decisions.js';
import type { RuleSummaries, RuleSummaryOutcome } from '../src/knowledge/summaries.js';
import type { KnowledgeVersions } from '../src/knowledge/versions.js';
import { noLimits } from './limits.js';

// The rule summary route with a fake service (ADR-0025).
const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const approver: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const summary = { overview: 'Um resumo.', watchPoints: ['Confira o valor.'] };

function setup({
  outcome = { ok: true, value: summary },
  listed = true,
  signedIn = approver,
  withSummaries = true,
  blocked = '',
}: {
  outcome?: RuleSummaryOutcome;
  listed?: boolean;
  signedIn?: SignedIn | null;
  withSummaries?: boolean;
  blocked?: string;
} = {}) {
  const asked: [string, number][] = [];
  const limited: [string, string][] = [];
  const ruleSummaries: RuleSummaries = {
    summarize: (routeId, number) => {
      asked.push([routeId, number]);
      return Promise.resolve(outcome);
    },
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
    knowledge: {
      isApprover: () => listed,
      decide: () => Promise.reject(new Error('not used')),
      states: () => Promise.resolve(new Map()),
    } satisfies KnowledgeDecisions,
    knowledgeVersions: {
      list: () => Promise.resolve([]),
      view: () => Promise.resolve(undefined),
    } satisfies KnowledgeVersions,
    ...(withSummaries ? { ruleSummaries } : {}),
  });
  const post = (body: unknown = { routeId: 'pt-d7', number: 2 }) =>
    app.request('/v1/knowledge/versions/summary', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { post, asked, limited };
}

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('POST /v1/knowledge/versions/summary (ADR-0025)', () => {
  it('summarizes a version for an approver under the per-minute and per-day limits', async () => {
    const { post, asked, limited } = setup();
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(summary);
    expect(asked).toEqual([['pt-d7', 2]]);
    expect(limited).toEqual([
      ['rule_summary_minute', approver.accountId],
      ['rule_summary_day', approver.accountId],
    ]);
  });

  it('refuses anyone off the approver list before counting or calling', async () => {
    const { post, asked, limited } = setup({ listed: false });
    const response = await post();
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('not_approver');
    expect([asked, limited]).toEqual([[], []]);
  });

  it('refuses a request with no session', async () => {
    const { post, asked } = setup({ signedIn: null });
    expect((await post()).status).toBe(401);
    expect(asked).toEqual([]);
  });

  it.each([
    ['not_found', 404],
    ['summary_unparsable', 502],
    ['summary_failed', 502],
    ['summary_unavailable', 503],
    ['summary_timeout', 504],
  ] as const)('answers %s as %i', async (reason, status) => {
    const response = await setup({ outcome: { ok: false, reason } }).post();
    expect(response.status).toBe(status);
    expect(await errorOf(response)).toBe(reason);
  });

  it('answers 503 when the deployment has no summarizer, before counting', async () => {
    const { post, limited } = setup({ withSummaries: false });
    const response = await post();
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe('summary_unavailable');
    expect(limited).toEqual([]);
  });

  it.each(['rule_summary_minute', 'rule_summary_day'])(
    'stops at the %s limit without calling the model',
    async (blocked) => {
      const { post, asked } = setup({ blocked });
      expect((await post()).status).toBe(429);
      expect(asked).toEqual([]);
    },
  );

  it.each([
    ['an unknown field', { routeId: 'pt-d7', number: 2, model: 'other' }],
    ['a bad route ID', { routeId: '../x', number: 2 }],
    ['no number', { routeId: 'pt-d7' }],
  ])('refuses %s', async (_, body) => {
    const { post, asked } = setup();
    expect((await post(body)).status).toBe(400);
    expect(asked).toEqual([]);
  });
});
