import type { Logger } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { SignedIn } from '../src/auth/service.js';
import type { AdminGrants } from '../src/knowledge/admin-grants.js';
import type { KnowledgeDecisions } from '../src/knowledge/decisions.js';
import type {
  RuleSummaries,
  RuleSummaryOutcome,
  StoredSummaryOutcome,
} from '../src/knowledge/summaries.js';
import type { KnowledgeVersions } from '../src/knowledge/versions.js';
import type { VersionView } from '@arca/domain';
import { noLimits } from './limits.js';

// The rule summary route with a fake service (ADR-0025).
const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const admin: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const summary = { overview: 'Um resumo.', watchPoints: ['Confira o valor.'] };

function setup({
  outcome = { ok: true, value: summary },
  stored = { ok: true, value: null },
  listed = true,
  signedIn = admin,
  withSummaries = true,
  blocked = '',
}: {
  outcome?: RuleSummaryOutcome;
  stored?: StoredSummaryOutcome;
  listed?: boolean;
  signedIn?: SignedIn | null;
  withSummaries?: boolean;
  blocked?: string;
} = {}) {
  const asked: [string, number][] = [];
  const read: [string, number][] = [];
  const limited: [string, string][] = [];
  const ruleSummaries: RuleSummaries = {
    stored: (routeId, number) => {
      read.push([routeId, number]);
      return Promise.resolve(stored);
    },
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
    admins: {
      isAdmin: () => Promise.resolve(listed),
      list: () => Promise.reject(new Error('not used')),
      grant: () => Promise.reject(new Error('not used')),
      remove: () => Promise.reject(new Error('not used')),
    } satisfies AdminGrants,
    knowledge: {
      decide: () => Promise.reject(new Error('not used')),
      states: () => Promise.resolve(new Map()),
    } satisfies KnowledgeDecisions,
    knowledgeVersions: {
      list: () => Promise.resolve([]),
      view: (_, number) => Promise.resolve(number === 2 ? ({} as VersionView) : undefined),
      comparisons: () => Promise.resolve([]),
      comparisonView: () => Promise.resolve(undefined),
    } satisfies KnowledgeVersions,
    ...(withSummaries ? { ruleSummaries } : {}),
  });
  const post = (body: unknown = { routeId: 'pt-d7', number: 2 }) =>
    app.request('/v1/knowledge/versions/summary', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const get = (query = 'routeId=pt-d7&number=2') =>
    app.request(`/v1/knowledge/versions/summary?${query}`, { headers: { origin } });
  return { post, get, asked, read, limited };
}

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('POST /v1/knowledge/versions/summary (ADR-0025)', () => {
  it('summarizes a version for an admin under the per-minute and per-day limits', async () => {
    const { post, asked, limited } = setup();
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(summary);
    expect(asked).toEqual([['pt-d7', 2]]);
    expect(limited).toEqual([
      ['rule_summary_minute', admin.accountId],
      ['rule_summary_day', admin.accountId],
    ]);
  });

  it('answers a stored summary with no call and no count', async () => {
    const { post, asked, limited } = setup({ stored: { ok: true, value: summary } });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(summary);
    expect([asked, limited]).toEqual([[], []]);
  });

  it('refuses anyone who is not an admin before counting or calling', async () => {
    const { post, asked, limited } = setup({ listed: false });
    const response = await post();
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('not_admin');
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

describe('GET /v1/knowledge/versions/summary (ADR-0025)', () => {
  it('answers the stored summary with no model call and no limit', async () => {
    const { get, asked, read, limited } = setup({ stored: { ok: true, value: summary } });
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ summary });
    expect([read, asked, limited]).toEqual([[['pt-d7', 2]], [], []]);
  });

  it('answers null when none is stored yet', async () => {
    const response = await setup({ stored: { ok: true, value: null } }).get();
    expect(await response.json()).toEqual({ summary: null });
  });

  it('answers not_found for a version the catalog does not hold', async () => {
    const response = await setup({ stored: { ok: false, reason: 'not_found' } }).get();
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe('not_found');
  });

  it('answers null with no summarizer, or not_found for an unknown version', async () => {
    const { get } = setup({ withSummaries: false });
    expect(await (await get()).json()).toEqual({ summary: null });
    expect((await get('routeId=pt-d7&number=3')).status).toBe(404);
  });

  it('refuses anyone who is not an admin, or with no session', async () => {
    const refused = setup({ listed: false });
    expect((await refused.get()).status).toBe(403);
    expect((await setup({ signedIn: null }).get()).status).toBe(401);
    expect(refused.read).toEqual([]);
  });

  it('refuses a bad query', async () => {
    const { get, read } = setup();
    expect((await get('routeId=../x&number=2')).status).toBe(400);
    expect(read).toEqual([]);
  });
});
