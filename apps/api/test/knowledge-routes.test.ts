import { KnowledgeComparisonVersion, KnowledgeVersion } from '@arca/api-contract/routes';
import { describe, expect, it } from 'vitest';
import type { Logger } from '@arca/telemetry';
import { createApp } from '../src/app.js';
import type { SignedIn } from '../src/auth/service.js';
import type { AdminGrants } from '../src/knowledge/admin-grants.js';
import type { DecisionOutcome, KnowledgeDecisions } from '../src/knowledge/decisions.js';
import type { RuleReportReview } from '../src/knowledge/reports.js';
import type { KnowledgeVersions } from '../src/knowledge/versions.js';
import { noLimits } from './limits.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const admin: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const decisionId = '0d1e2f30-4152-4637-8a9b-0c1d2e3f4a5b';
const version = { routeId: 'pt-d7', number: 2 };
const comparison = { comparisonId: 'destinations', number: 1 };

function setup({
  signedIn = admin,
  outcome = { decided: decisionId },
  listed = true,
}: {
  signedIn?: SignedIn | null;
  outcome?: DecisionOutcome;
  listed?: boolean;
} = {}) {
  const calls: unknown[][] = [];
  const admins: AdminGrants = {
    isAdmin: () => Promise.resolve(listed),
    list: () => Promise.resolve([]),
    grant: () => Promise.resolve('changed'),
    remove: () => Promise.resolve('changed'),
  };
  const knowledge: KnowledgeDecisions = {
    decide: (...args) => {
      calls.push(args);
      return Promise.resolve(outcome);
    },
    states: () => Promise.resolve(new Map()),
  };
  const listedVersion = KnowledgeVersion.omit({ check: true }).parse({
    routeId: 'pt-d7',
    number: 2,
    title: 'Visto D7',
    country: 'PT',
    effectiveFrom: '2026-01-01',
    hash: 'a'.repeat(64),
    state: 'proposed',
  });
  const listedComparison = KnowledgeComparisonVersion.parse({
    ...comparison,
    title: 'Destination comparison',
    hash: 'b'.repeat(64),
    state: 'proposed',
  });
  const knowledgeVersions: KnowledgeVersions = {
    list: () => Promise.resolve([listedVersion]),
    view: () => Promise.resolve(undefined),
    comparisons: () => Promise.resolve([listedComparison]),
    comparisonView: () => Promise.resolve(undefined),
  };
  const openReports = [
    { routeId: 'pt-d7', versionNumber: 2, requirementId: 'income', reason: 'outdated', count: 3 },
  ] as const;
  const ruleReports: RuleReportReview = {
    open: () => Promise.resolve([...openReports]),
    close: (reference) => {
      calls.push(['close', reference]);
      return Promise.resolve(3);
    },
  };
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(signedIn),
      refresh: () =>
        Promise.resolve({
          session:
            signedIn === null
              ? null
              : {
                  accountId: signedIn.accountId,
                  email: 'owner@example.com',
                  confirmed: true,
                  device: { browser: 'firefox', os: 'linux' },
                },
          setCookies: [],
        }),
    },
    authLimits: noLimits,
    knowledge,
    admins,
    knowledgeVersions,
    ruleReports,
  });
  const decide = (
    kind: 'activate' | 'reject',
    body: unknown = version,
    collection: 'versions' | 'comparisons' = 'versions',
    headers: Record<string, string> = { origin },
  ) =>
    app.request(`/v1/knowledge/${collection}/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const read = (path: string, collection: 'versions' | 'comparisons' = 'versions') =>
    app.request(`/v1/knowledge/${collection}${path}`);
  const reports = () => app.request('/v1/knowledge/reports');
  const close = (body: unknown) =>
    app.request('/v1/knowledge/reports/close', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return {
    app,
    decide,
    read,
    reports,
    close,
    calls,
    listedVersion,
    listedComparison,
    openReports,
  };
}

describe('GET /v1/session for admins (ADR-0027)', () => {
  it('says whether the account is an admin', async () => {
    for (const listed of [true, false]) {
      const response = await setup({ listed }).app.request('/v1/session');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ admin: listed });
    }
  });
});

describe('POST /v1/knowledge/versions (spec 0007, R7; ADR-0027)', () => {
  it.each(['activate', 'reject'] as const)('%ss with no step-up', async (kind) => {
    const { decide, calls } = setup();
    const response = await decide(kind);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ decisionId });
    expect(calls).toEqual([[admin, kind, { subject: 'route', ...version }]]);
  });

  it.each<[Extract<DecisionOutcome, { refused: string }>['refused'], number]>([
    ['not_admin', 403],
    ['not_found', 404],
    ['already_rejected', 409],
  ])('answers %s with %i', async (refused, status) => {
    const { decide } = setup({ outcome: { refused } });
    const response = await decide('activate');
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code: refused } });
  });

  it('answers 401 signed out and 403 to an account that is not an admin, deciding nothing', async () => {
    const signedOut = setup({ signedIn: null });
    expect((await signedOut.decide('activate')).status).toBe(401);
    const other = setup({ listed: false });
    const response = await other.decide('activate');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'not_admin' } });
    expect([...signedOut.calls, ...other.calls]).toEqual([]);
  });

  it('answers 400 for a malformed version or a body with more than the version', async () => {
    const { decide, calls } = setup();
    expect((await decide('reject', { routeId: 'Not a route', number: 0 })).status).toBe(400);
    expect((await decide('reject', { ...version, contentHash: 'a'.repeat(64) })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it.each([
    ['another origin', { origin: 'https://evil.test' }],
    ['a cross-site fetch with no origin', { 'sec-fetch-site': 'cross-site' }],
    ['no origin at all', {}],
  ])('refuses a decision from %s, deciding nothing', async (_name, headers) => {
    const { decide, calls } = setup();
    for (const collection of ['versions', 'comparisons'] as const) {
      const response = await decide(
        'activate',
        collection === 'versions' ? version : comparison,
        collection,
        headers,
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: { code: 'cross_origin' } });
    }
    expect(calls).toEqual([]);
  });

  it('lists the route and comparison versions for an admin and refuses anyone else', async () => {
    const { read, listedVersion, listedComparison } = setup();
    const response = await read('');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      versions: [{ ...listedVersion, check: 'none' }],
      comparisons: [listedComparison],
    });
    const other = setup({ listed: false });
    expect((await other.read('')).status).toBe(403);
    expect((await other.read('/view?routeId=pt-d7&number=2')).status).toBe(403);
  });

  it('answers 404 for a version it does not hold and 400 for a malformed one', async () => {
    const { read } = setup();
    expect((await read('/view?routeId=pt-d7&number=2')).status).toBe(404);
    expect((await read('/view?routeId=Nope&number=0')).status).toBe(400);
  });
});

describe('POST /v1/knowledge/comparisons (ADR-0026)', () => {
  it.each(['activate', 'reject'] as const)(
    '%ss a comparison version as its own subject kind',
    async (kind) => {
      const { decide, calls } = setup();
      const response = await decide(kind, comparison, 'comparisons');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ decisionId });
      expect(calls).toEqual([[admin, kind, { subject: 'comparison', ...comparison }]]);
    },
  );

  it('never takes a route version as a comparison, nor the reverse', async () => {
    const { decide, calls } = setup();
    expect((await decide('activate', version, 'comparisons')).status).toBe(400);
    expect((await decide('activate', comparison, 'versions')).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('answers 403 to an account not on the list, deciding nothing', async () => {
    const other = setup({ listed: false });
    expect((await other.decide('reject', comparison, 'comparisons')).status).toBe(403);
    expect(other.calls).toEqual([]);
  });

  it('views a comparison version only for an admin, 404 when it is not bundled', async () => {
    const { read } = setup();
    expect((await read('/view?comparisonId=destinations&number=1', 'comparisons')).status).toBe(
      404,
    );
    expect((await read('/view?comparisonId=Nope&number=0', 'comparisons')).status).toBe(400);
    const other = setup({ listed: false });
    expect(
      (await other.read('/view?comparisonId=destinations&number=1', 'comparisons')).status,
    ).toBe(403);
  });
});

describe('the rule reports (spec 0007, R8)', () => {
  const reference = { routeId: 'pt-d7', versionNumber: 2, requirementId: 'income' };

  it('lists the open reports and closes one requirement’s for an admin', async () => {
    const { reports, close, calls, openReports } = setup();
    const listed = await reports();
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ reports: openReports });
    const closed = await close(reference);
    expect(closed.status).toBe(200);
    expect(await closed.json()).toEqual({ closed: 3 });
    expect(calls).toEqual([['close', reference]]);
  });

  it('answers 401 signed out and 403 to an account not on the list, closing nothing', async () => {
    expect((await setup({ signedIn: null }).reports()).status).toBe(401);
    const other = setup({ listed: false });
    expect((await other.reports()).status).toBe(403);
    expect((await other.close(reference)).status).toBe(403);
    expect(other.calls).toEqual([]);
  });
});
