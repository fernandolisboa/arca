import { checkItems, routeVersionSchema } from '@arca/domain';
import { casesFileSchema, routeVersionContentHash, versionCasesHash } from '@arca/knowledge';
import { bundledRuleData, ruleContent } from '@arca/knowledge/bundled';
import { withIdentity } from '@arca/db';
import { createLogger } from '@arca/telemetry';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { auditLog } from '../../src/audit/log.js';
import { credentialStore } from '../../src/auth/auth.js';
import { createStepUp } from '../../src/auth/step-up.js';
import type { AdminGrants } from '../../src/knowledge/admin-grants.js';
import { adminRole } from '../../src/knowledge/admins.js';
import { offlineFetcher } from '../../src/knowledge/pages/environment.js';
import { createKnowledgeDecisions } from '../../src/knowledge/decisions.js';
import { officialDomainsView } from '../../src/knowledge/official-domains.js';
import { postgresRuleStore } from '../../src/knowledge/rule-store.js';
import {
  RuleResearcherError,
  type RuleResearcher,
  type RuleValidator,
} from '../../src/knowledge/update/ports.js';
import type { SourceFetcher } from '../../src/knowledge/pages/fetcher.js';
import { createUpdateRequests, updateLiveMs } from '../../src/knowledge/update/requests.js';
import { createVersionReviews } from '../../src/knowledge/update/review.js';
import { createRuleUpdate } from '../../src/knowledge/update/run.js';
import {
  scriptedRuleResearcher,
  scriptedRuleValidator,
} from '../../src/knowledge/update/scripted.js';
import { postgresUpdateStore } from '../../src/knowledge/update/store.js';
import { noLimits } from '../limits.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';
import { decideWithStepUp } from './knowledge-decision-legacy.js';
import { origin, person, type Person } from './step-up-people.js';

// Update requests (ADR-0031) on the real migrations and the imported rules, with the scripted
// models only: no model is called. Synthetic accounts only.
let testDatabase: AuthTestDatabase;
let owner: Person;
let member: Person;
let routeId: string;
let otherRouteId: string;
let freeRouteId: string;
let quotedRouteId: string;
let sourceRouteId: string;
let tamperedRouteId: string;
let reviewRouteId: string;
let logLines: string[];

const readRules = () => {
  const store = postgresRuleStore(() => testDatabase.apiDb, silentLogger);
  return { rows: store.rows, reading: store.reading };
};

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  owner = await person(testDatabase);
  member = await person(testDatabase);
  // Routes whose newest version re-proposed as is passes every check: its cases carry their
  // snapshots inline, as a proposal's must.
  const rows = await postgresRuleStore(() => testDatabase.apiDb, silentLogger).rows();
  const newest = new Map<string, (typeof rows.routeVersions)[number]>();
  for (const row of rows.routeVersions) {
    if ((newest.get(row.routeId)?.number ?? 0) < row.number) newest.set(row.routeId, row);
  }
  const passing = [...newest.values()].filter((row) => {
    const cases = casesFileSchema.safeParse(row.cases);
    const content = routeVersionSchema.safeParse(row.content);
    return (
      cases.success &&
      content.success &&
      content.data.status === 'open' &&
      cases.data.cases.every(
        ({ snapshot, supersedes }) => snapshot !== undefined && supersedes === undefined,
      )
    );
  });
  const [first, second, third, fourth, fifth, sixth, seventh] = passing;
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    fifth === undefined ||
    sixth === undefined ||
    seventh === undefined
  ) {
    throw new Error('Seven routes expected');
  }
  reviewRouteId = seventh.routeId;
  sourceRouteId = fifth.routeId;
  tamperedRouteId = sixth.routeId;
  quotedRouteId = fourth.routeId;
  routeId = first.routeId;
  otherRouteId = second.routeId;
  freeRouteId = third.routeId;
}, 60_000);

afterAll(async () => {
  await testDatabase.drop();
});

beforeEach(() => {
  logLines = [];
});

interface Options {
  readonly signedIn?: Person;
  readonly configured?: boolean;
  readonly runFails?: boolean;
  readonly researcher?: RuleResearcher;
  readonly validator?: RuleValidator;
  readonly fetcher?: SourceFetcher;
  /** The page text every official page reads as, for a hand edit's quote. */
  readonly pageText?: string;
  /** Milliseconds added to the clock the progress reads. */
  readonly later?: number;
}

function setup({
  signedIn = owner,
  configured = true,
  runFails = false,
  researcher = scriptedRuleResearcher,
  validator = scriptedRuleValidator,
  fetcher = offlineFetcher,
  pageText = '',
  later = 0,
}: Options = {}) {
  const runs: string[] = [];
  const rules = postgresRuleStore(() => testDatabase.jobsDb, silentLogger);
  const step = createRuleUpdate({
    store: postgresUpdateStore(() => testDatabase.jobsDb),
    rows: rules.rows,
    reading: rules.reading,
    fetcher,
    researcher,
    validator,
    model: () => Promise.resolve({ model: 'fake', effort: null }),
    today: () => '2026-11-17',
    logger: silentLogger,
    now: () => 0,
  });
  const requests = createUpdateRequests({
    db: () => testDatabase.apiDb,
    role: adminRole(() => testDatabase.apiDb, [owner.signedIn.accountId]),
    audit: auditLog(testDatabase.auditDb),
    store: postgresUpdateStore(() => testDatabase.apiDb),
    ...readRules(),
    states: () => decisions().states(),
    configured: () => Promise.resolve(configured),
    run: (requestId) => {
      if (runFails) return Promise.reject(new Error('workflow down'));
      runs.push(requestId);
      return Promise.resolve();
    },
    logger: createLogger((line) => logLines.push(line)),
    now: () => Date.now() + later,
  });
  const reviews = createVersionReviews({
    db: () => testDatabase.apiDb,
    role: adminRole(() => testDatabase.apiDb, [owner.signedIn.accountId]),
    audit: auditLog(testDatabase.auditDb),
    store: postgresUpdateStore(() => testDatabase.apiDb),
    ...readRules(),
    states: () => decisions().states(),
    fetcher: {
      fetch: (url) =>
        Promise.resolve({ ok: true, status: 200, text: pageText, cut: false, chain: [url] }),
    },
    today: () => '2026-11-17',
  });
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(signedIn.signedIn),
      refresh: () => Promise.resolve({ session: null, setCookies: [] }),
    },
    authLimits: noLimits,
    updateRequests: requests,
    versionReviews: reviews,
    admins: {
      isAdmin: (accountId) => Promise.resolve(accountId === owner.signedIn.accountId),
      list: () => Promise.reject(new Error('not used')),
      grant: () => Promise.reject(new Error('not used')),
      remove: () => Promise.reject(new Error('not used')),
    } satisfies AdminGrants,
  });
  const review = async (route: string, number: number) => {
    const response = await app.request(
      `/v1/knowledge/versions/review?routeId=${route}&number=${String(number)}`,
    );
    return { status: response.status, body: (await response.json()) as Review };
  };
  const edit = async (body: unknown) => {
    const response = await app.request('/v1/knowledge/versions/edit-item', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const start = (route: string) =>
    app.request('/v1/knowledge/update-requests', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ routeId: route }),
    });
  const progress = async (route: string) => {
    const response = await app.request(`/v1/knowledge/update-requests?routeId=${route}`);
    expect(response.status).toBe(200);
    return ((await response.json()) as { request: Progress | null }).request;
  };
  /** Runs the request's steps as the workflow would, until none remain. */
  const runAll = async (requestId: string) => {
    for (let index = 0; index < 5 && (await step(requestId)); index += 1);
  };
  return { start, progress, runAll, runs, review, edit };
}

interface Progress {
  requestId: string;
  routeId: string;
  baseNumber: number;
  state: string;
  failure: string | null;
  stages: { stage: string; state: string }[];
  cost: { kind: string } | null;
  lists: Record<string, number> | null;
  contentHash: string | null;
  proposedNumber: number | null;
}

interface Review {
  origin: string;
  items: { key: string; list: string; edited: boolean; quotes: { url: string; quote: string }[] }[];
  editable: { key: string; kind: string; content: string }[];
}

/** The decisions over the stored rules, as the server builds them, with a step-up service. */
function decisions() {
  const store = postgresRuleStore(() => testDatabase.apiDb, silentLogger);
  return createKnowledgeDecisions({
    db: testDatabase.apiDb,
    stepUp: stepUpService(),
    audit: auditLog(testDatabase.auditDb),
    catalog: async () => (await store.engine()).catalog,
    casesHash: async (contentHash) => versionCasesHash(await store.data(), contentHash),
    comparisons: { identities: () => [] },
    officialDomains: async () => officialDomainsView(await store.rows(), store.reading),
    role: adminRole(() => testDatabase.apiDb, [owner.signedIn.accountId]),
    origin,
    logger: silentLogger,
  });
}

const stepUpService = () =>
  createStepUp({
    db: testDatabase.authDb,
    credentials: credentialStore(testDatabase.authDb),
    audit: auditLog(testDatabase.auditDb),
    origin,
    logger: silentLogger,
  });

/** The stored rules' identity of one route version, with its content and cases hashes. */
async function storedIdentity(route: string, number: number) {
  const store = postgresRuleStore(() => testDatabase.apiDb, silentLogger);
  const identity = (await store.engine()).catalog
    .identities(route)
    .find((each) => each.number === number);
  if (identity === undefined) throw new Error('A stored version expected');
  return { identity, casesHash: versionCasesHash(await store.data(), identity.hash) ?? '' };
}

const states = (progress: Progress | null) =>
  progress?.stages.map(({ stage, state }) => `${stage}:${state}`);

const auditDetails = () =>
  testDatabase.asAdmin(async (client) =>
    (
      await client.query<{ details: unknown }>(
        `SELECT details FROM audit.event WHERE code = 'update_requested' ORDER BY time, id`,
      )
    ).rows.map(({ details }) => details),
  );

describe('update requests (ADR-0031)', () => {
  it('starts one request per route, runs research to a proposal with three lists, then frees the route', async () => {
    const { start, progress, runAll, runs } = setup();
    expect(await progress(routeId)).toBeNull();

    const started = await start(routeId);
    expect(started.status).toBe(200);
    const { requestId } = (await started.json()) as { requestId: string };
    expect(runs).toEqual([requestId]);
    expect(await auditDetails()).toContainEqual(expect.objectContaining({ requestId, routeId }));

    const asked = await progress(routeId);
    expect(asked).toMatchObject({
      requestId,
      routeId,
      state: 'running',
      failure: null,
      cost: null,
    });
    expect(states(asked)).toEqual([
      'research:running',
      'validation:pending',
      'correction:pending',
      'final_validation:pending',
    ]);

    // One live request per route; another route is free.
    const again = await start(routeId);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: { code: 'update_live' } });
    expect((await start(otherRouteId)).status).toBe(200);

    await runAll(requestId);
    const ended = await progress(routeId);
    expect(ended).toMatchObject({ state: 'finished', failure: null, cost: { kind: 'scripted' } });
    expect(ended?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // The proposal is stored as a proposed version that names its request.
    const proposed = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ number: number; content_hash: string }>(
            'SELECT number, content_hash FROM knowledge.route_version WHERE request_id = $1',
            [requestId],
          )
        ).rows,
    );
    expect(proposed).toEqual([{ number: ended?.proposedNumber, content_hash: ended?.contentHash }]);
    expect(ended?.proposedNumber).toBe((ended?.baseNumber ?? 0) + 1);
    // The stored proposal is the version itself, hashed as the read will re-check it.
    const stored = await postgresUpdateStore(() => testDatabase.apiDb).end(requestId);
    if (stored?.failure !== null) throw new Error('A proposal expected');
    expect(routeVersionSchema.safeParse(stored.proposal.content).success).toBe(true);
    const rules = readRules();
    expect(
      routeVersionContentHash(await rules.rows(), stored.proposal.content as never, rules.reading),
    ).toBe(ended?.contentHash);
    expect(ended?.stages.every(({ state }) => state === 'done' || state === 'skipped')).toBe(true);
    const lists = ended?.lists ?? {};
    expect(Object.keys(lists).sort()).toEqual(['confirmed', 'divergent', 'unconfirmed']);
    // Research quoted nothing, so nothing is confirmed.
    expect(lists['confirmed']).toBe(0);
    expect((lists['divergent'] ?? 0) + (lists['unconfirmed'] ?? 0)).toBeGreaterThan(0);

    // A finished request no longer blocks; running it again changes nothing.
    await runAll(requestId);
    expect(await progress(routeId)).toEqual(ended);
    expect((await start(routeId)).status).toBe(200);
  });

  it('ends with a fixed failure code when research fails, and skips the stages after it', async () => {
    const researcher: RuleResearcher = {
      research: () => Promise.reject(new RuleResearcherError('timeout')),
    };
    const { start, progress, runAll } = setup({ researcher });
    // The other route's request from the test above is still live; this run fails it.
    expect((await start(otherRouteId)).status).toBe(409);
    const live = await progress(otherRouteId);
    if (live === null) throw new Error('A live request expected');
    await runAll(live.requestId);
    const failed = await progress(otherRouteId);
    expect(failed).toMatchObject({ state: 'failed', failure: 'research_timeout', lists: null });
    expect(states(failed)).toEqual([
      'research:failed',
      'validation:skipped',
      'correction:skipped',
      'final_validation:skipped',
    ]);
  });

  it('shows a request with no end after an hour as stalled', async () => {
    const live = setup();
    const { progress } = setup({ later: updateLiveMs + 1 });
    const started = await live.start(otherRouteId);
    expect(started.status).toBe(200);
    expect(await progress(otherRouteId)).toMatchObject({ state: 'stalled', failure: null });
  });

  it('refuses anyone but an admin, a route with no version, and a deployment with no keys', async () => {
    const memberStart = await setup({ signedIn: member }).start(routeId);
    expect(memberStart.status).toBe(403);
    expect(await memberStart.json()).toEqual({ error: { code: 'not_admin' } });
    const memberRead = await createAppRead(member);
    expect(memberRead.status).toBe(403);
    expect((await setup().start('zz-no-such-route')).status).toBe(404);
    const off = await setup({ configured: false }).start(routeId);
    expect(off.status).toBe(503);
    expect(await off.json()).toEqual({ error: { code: 'update_off' } });
  });

  it('answers 502 when the run cannot begin, and the request then counts as live', async () => {
    const { start } = setup({ runFails: true });
    const failed = await start(freeRouteId);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: { code: 'update_not_started' } });
    expect(logLines.join('\n')).toContain('update_not_started');
    expect((await setup().start(freeRouteId)).status).toBe(409);
  });
});

function createAppRead(signedIn: Person) {
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(signedIn.signedIn),
      refresh: () => Promise.resolve({ session: null, setCookies: [] }),
    },
    authLimits: noLimits,
    updateRequests: createUpdateRequests({
      db: () => testDatabase.apiDb,
      role: adminRole(() => testDatabase.apiDb, [owner.signedIn.accountId]),
      audit: auditLog(testDatabase.auditDb),
      store: postgresUpdateStore(() => testDatabase.apiDb),
      ...readRules(),
      states: () => decisions().states(),
      configured: () => Promise.resolve(true),
      run: () => Promise.resolve(),
      logger: silentLogger,
      now: () => Date.now(),
    }),
  });
  return app.request(`/v1/knowledge/update-requests?routeId=${routeId}`);
}

describe('knowledge.start_update_request (ADR-0031)', () => {
  /** Calls the definer as app_api with the account set, in a transaction rolled back after. */
  const call = (accountId: string | null, basis: string, grantId: string | null) =>
    testDatabase.asAdmin(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE app_api');
        if (accountId !== null) {
          await client.query(`SELECT set_config('app.account_id', $1, true)`, [accountId]);
        }
        const { rows } = await client.query<{ id: string | null }>(
          'SELECT knowledge.start_update_request($1, 1, $2, $3::uuid) AS id',
          [freeRouteId, basis, grantId],
        );
        return rows[0]?.id ?? null;
      } catch (error) {
        return (error as { code?: string }).code ?? 'error';
      } finally {
        await client.query('ROLLBACK');
      }
    });

  it('refuses anyone the admin basis does not hold for', async () => {
    expect(await call(null, 'owner_list', null)).toBe('42501');
    expect(await call(member.signedIn.accountId, 'grant', member.signedIn.accountId)).toBe('42501');
    expect(await call(owner.signedIn.accountId, 'nonsense', null)).toBe('42501');
  });

  it('answers null while a request of the route is live', async () => {
    // The 502 test above left a live request on this route.
    expect(await call(owner.signedIn.accountId, 'owner_list', null)).toBeNull();
  });
});

describe('validation with quotes (ADR-0031)', () => {
  /** The route's newest version's items that state no value, each with a quote on its page. */
  const quotedItems = () => {
    const entries = [...ruleContent(bundledRuleData).entries.values()].filter(
      ({ version }) => version.routeId === quotedRouteId,
    );
    const newest = entries.reduce((left, right) =>
      left.version.number >= right.version.number ? left : right,
    );
    return checkItems(newest)
      .filter(({ values, urls }) => values.length === 0 && urls.length > 0)
      .map(({ key, urls }) => ({
        key,
        url: urls[0] ?? '',
        quote: `The official text that states ${key} on this page.`,
      }));
  };

  it('asks the validator once per page text, and counts low confidence as cannot tell', async () => {
    const quotes = quotedItems();
    expect(quotes.length).toBeGreaterThan(0);
    const researcher: RuleResearcher = {
      research: async (request, model) => {
        const reply = await scriptedRuleResearcher.research(request, model);
        return { ...reply, reply: { ...(reply.reply as object), quotes } };
      },
    };
    let pageText = quotes.map(({ quote }) => quote).join('\n');
    const fetcher: SourceFetcher = {
      fetch: (url) =>
        Promise.resolve({ ok: true, status: 200, text: pageText, cut: false, chain: [url] }),
    };
    let asked = 0;
    let confidence = 0.9;
    const validator: RuleValidator = {
      promptVersion: 'test',
      validate: (items) => {
        asked += 1;
        return Promise.resolve({
          reply: items.map(({ id }) => ({ id, choice: 'supports' as const, confidence })),
          model: 'fake',
          promptVersion: 'test',
        });
      },
    };
    const run = async () => {
      const { start, progress, runAll } = setup({ researcher, validator, fetcher });
      const started = await start(quotedRouteId);
      expect(started.status).toBe(200);
      const { requestId } = (await started.json()) as { requestId: string };
      await runAll(requestId);
      return progress(quotedRouteId);
    };

    const first = await run();
    expect(asked).toBe(1);
    expect(first?.lists?.['confirmed']).toBeGreaterThan(0);

    // The same quotes on the same page text: every answer comes from the cache.
    const second = await run();
    expect(asked).toBe(1);
    expect(second?.lists).toEqual(first?.lists);

    // A changed page asks again; an answer below the confidence floor confirms nothing.
    pageText = `${pageText}\nAmended.`;
    confidence = 0.4;
    const third = await run();
    expect(asked).toBe(2);
    expect(third?.lists?.['confirmed']).toBe(0);
  });
});

describe('what code refuses (ADR-0031)', () => {
  it('gives a new source nobody read no date: the proposal is refused, even after its correction', async () => {
    const researcher: RuleResearcher = {
      research: async (request, model) => {
        const reply = await scriptedRuleResearcher.research(request, model);
        const version = JSON.parse((reply.reply as { versionJson: string }).versionJson) as {
          sources: { url: string }[];
        };
        const [source, ...rest] = version.sources;
        if (source === undefined) throw new Error('A source expected');
        const moved = {
          ...version,
          sources: [{ ...source, url: `${source.url}?moved=1` }, ...rest],
        };
        return {
          ...reply,
          reply: { ...(reply.reply as object), versionJson: JSON.stringify(moved) },
        };
      },
    };
    const { start, progress, runAll } = setup({ researcher });
    const started = await start(sourceRouteId);
    const { requestId } = (await started.json()) as { requestId: string };
    await runAll(requestId);
    expect(await progress(sourceRouteId)).toMatchObject({
      state: 'failed',
      failure: 'proposal_invalid',
    });
    const stages = await postgresUpdateStore(() => testDatabase.apiDb).stages(requestId);
    expect(JSON.stringify(stages.at(-1)?.output)).toContain(
      'could not be read, so it has no verification date',
    );
  });

  it('never starts or runs research from a version row changed in place', async () => {
    const { start, progress, runAll } = setup();
    const started = await start(tamperedRouteId);
    expect(started.status).toBe(200);
    const { requestId } = (await started.json()) as { requestId: string };
    await testDatabase.asAdmin((client) =>
      client.query(
        `UPDATE knowledge.route_version SET content_hash = repeat('0', 64) WHERE route_id = $1`,
        [tamperedRouteId],
      ),
    );
    await runAll(requestId);
    expect(await progress(tamperedRouteId)).toMatchObject({
      state: 'failed',
      failure: 'unknown_route',
    });
    expect((await setup().start(tamperedRouteId)).status).toBe(404);
  });
});

describe('reviewing a proposal (ADR-0031, #460)', () => {
  /** The review route's newest imported version's items that state no value, with an official page. */
  const quotable = () => {
    const entries = [...ruleContent(bundledRuleData).entries.values()].filter(
      ({ version }) => version.routeId === reviewRouteId,
    );
    const newest = entries.reduce((left, right) =>
      left.version.number >= right.version.number ? left : right,
    );
    return checkItems(newest).filter(({ values, urls }) => values.length === 0 && urls.length > 0);
  };

  /** Runs a request of the review route to its proposal and answers the proposed number. */
  const propose = async () => {
    const { start, progress, runAll } = setup();
    const started = await start(reviewRouteId);
    expect(started.status).toBe(200);
    const { requestId } = (await started.json()) as { requestId: string };
    await runAll(requestId);
    const ended = await progress(reviewRouteId);
    if (ended?.proposedNumber == null) throw new Error('A proposed version expected');
    return ended;
  };

  it('shows the three lists of the request that proposed it, then approves and rejects it with a step-up', async () => {
    const ended = await propose();
    const number = ended.proposedNumber ?? 0;
    const { review } = setup();
    const shown = await review(reviewRouteId, number);
    expect(shown.status).toBe(200);
    expect(shown.body.origin).toBe('request');
    const counted = Object.fromEntries(
      ['confirmed', 'divergent', 'unconfirmed'].map((list) => [
        list,
        shown.body.items.filter((item) => item.list === list).length,
      ]),
    );
    expect(counted).toEqual(ended.lists);
    expect(shown.body.items.every(({ edited }) => !edited)).toBe(true);
    expect(shown.body.editable.length).toBeGreaterThan(0);
    // The version the request started from reads as no request's.
    expect((await review(reviewRouteId, ended.baseNumber)).body).toMatchObject({
      origin: 'none',
      items: [],
    });
    expect((await review(reviewRouteId, number + 50)).status).toBe(404);
    expect((await setup({ signedIn: member }).review(reviewRouteId, number)).status).toBe(403);

    const { identity, casesHash } = await storedIdentity(reviewRouteId, number);
    const key = `${reviewRouteId}/${String(number)}/${identity.hash}`;
    expect((await decisions().states()).get(key)).toBeUndefined();
    const stepUp = stepUpService();
    expect(
      await decideWithStepUp(stepUp, decisions(), owner, 'activate', identity, casesHash),
    ).toHaveProperty('decided');
    expect((await decisions().states()).get(key)).toBe('active');
    // A step-up bound to other cases decides nothing.
    expect(
      await decideWithStepUp(stepUp, decisions(), owner, 'reject', identity, 'f'.repeat(64)),
    ).toEqual({ refused: 'step_up_required' });
    expect(
      await decideWithStepUp(stepUp, decisions(), owner, 'reject', identity, casesHash),
    ).toHaveProperty('decided');
    expect((await decisions().states()).get(key)).toBe('rejected');
  });

  it('ends a request whose number another version took meanwhile as out of order', async () => {
    const ended = await propose();
    const store = postgresUpdateStore(() => testDatabase.jobsDb);
    const prior = await store.end(ended.requestId);
    if (prior?.failure !== null) throw new Error('A proposal expected');
    // A request that ran past its live hour: the route is free, so another one starts.
    const late = await setup().start(reviewRouteId);
    const { requestId } = (await late.json()) as { requestId: string };
    await store.finish(requestId, { proposal: prior.proposal });
    expect(await store.end(requestId)).toMatchObject({ failure: 'out_of_order' });
  });

  it('lets no role store a proposed version or a hand edit past the checks the database makes', async () => {
    const ended = await propose();
    const number = ended.proposedNumber ?? 0;
    const content = sql`(SELECT content FROM knowledge.route_version
                          WHERE route_id = ${reviewRouteId} AND number = ${number})`;
    const proposal = (requestId: string, hash: string | null) => sql`
      INSERT INTO knowledge.route_version (route_id, number, content, content_hash, cases,
                                           request_id)
      VALUES (${reviewRouteId}, ${number + 1}, ${content}, ${hash ?? ended.contentHash}, NULL,
              ${requestId})`;
    const refusedBy = (pattern: RegExp) => ({
      cause: { message: expect.stringMatching(pattern) as unknown },
    });
    // app_jobs: a request with no end, or an end under another hash.
    const openId = randomUUID();
    await testDatabase.asAdmin((client) =>
      client.query(
        `INSERT INTO knowledge.update_request (id, route_id, base_number, requested_at)
         VALUES ($1, $2, $3, now() - interval '2 hours')`,
        [openId, reviewRouteId, number],
      ),
    );
    await expect(testDatabase.jobsDb.execute(proposal(openId, null))).rejects.toMatchObject(
      refusedBy(/row-level security/),
    );
    await expect(
      testDatabase.jobsDb.execute(proposal(ended.requestId, '0'.repeat(64))),
    ).rejects.toMatchObject(refusedBy(/row-level security|duplicate key/));
    // app_api: no direct write, and the function re-checks the basis it is given.
    await expect(
      testDatabase.apiDb.execute(sql`
        INSERT INTO knowledge.version_edit (route_id, number, item_key, url, quote)
        VALUES (${reviewRouteId}, ${number}, 'requirement:x', 'https://example.gov', 'x')`),
    ).rejects.toMatchObject(refusedBy(/^permission denied/));
    await expect(
      withIdentity(testDatabase.apiDb, { accountId: member.signedIn.accountId }, (tx) =>
        tx.execute(sql`
          SELECT knowledge.edit_route_version(${reviewRouteId}, ${number + 1}, ${number},
            ${content}, ${'0'.repeat(64)}, NULL, 'requirement:x', 'https://example.gov', 'x',
            'grant', ${randomUUID()}::uuid)`),
      ),
    ).rejects.toMatchObject(refusedBy(/only an admin edits/));
  });

  it('stores a hand edit as a new proposed version that corrects the edited one, quote checked on the page', async () => {
    const ended = await propose();
    const number = ended.proposedNumber ?? 0;
    const [item] = quotable();
    if (item === undefined) throw new Error('A quotable item expected');
    const url = item.urls[0] ?? '';
    const quote = `The official text that states ${item.key} on this page.`;
    const shown = (await setup().review(reviewRouteId, number)).body;
    const stored = shown.editable.find(({ key }) => key === item.key);
    if (stored === undefined) throw new Error('The item is editable');
    const request = {
      routeId: reviewRouteId,
      number,
      itemKey: item.key,
      content: stored.content,
      source: { url, title: 'Official page' },
      quote,
    };

    // A quote the page does not hold is refused with the reason, and nothing is stored.
    const missing = await setup({ pageText: 'Another text.' }).edit(request);
    expect(missing.status).toBe(200);
    expect(missing.body).toMatchObject({ outcome: 'refused' });
    // An item whose ID changed is refused too.
    const renamed = await setup({ pageText: quote }).edit({
      ...request,
      content: JSON.stringify({ ...(JSON.parse(stored.content) as object), id: 'renamed' }),
    });
    expect(renamed.body).toMatchObject({ outcome: 'refused' });
    expect((await setup({ signedIn: member, pageText: quote }).edit(request)).status).toBe(403);

    const { edit, review } = setup({ pageText: quote });
    const saved = await edit(request);
    expect(saved).toEqual({ status: 200, body: { outcome: 'stored', number: number + 1 } });
    const row = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<Record<string, unknown>>(
            `SELECT v.request_id, v.content->>'corrects' AS corrects, e.item_key, e.url, e.quote
               FROM knowledge.route_version v
               JOIN knowledge.version_edit e USING (route_id, number)
              WHERE v.route_id = $1 AND v.number = $2`,
            [reviewRouteId, number + 1],
          )
        ).rows,
    );
    expect(row).toEqual([
      { request_id: null, corrects: String(number), item_key: item.key, url, quote },
    ]);
    const corrected = (await review(reviewRouteId, number + 1)).body;
    expect(corrected.origin).toBe('edit');
    expect(corrected.items[0]).toMatchObject({
      key: item.key,
      list: 'confirmed',
      edited: true,
      quotes: [{ url, quote }],
    });
    expect(corrected.items.filter(({ key }) => key === item.key)).toHaveLength(1);
    // The edit reads as proposed, so it is decided like any version.
    const { identity, casesHash } = await storedIdentity(reviewRouteId, number + 1);
    const key = `${reviewRouteId}/${String(number + 1)}/${identity.hash}`;
    expect((await decisions().states()).get(key)).toBeUndefined();
    expect(
      await decideWithStepUp(stepUpService(), decisions(), owner, 'reject', identity, casesHash),
    ).toHaveProperty('decided');
    expect((await edit({ ...request, number: number + 1 })).body).toEqual({
      error: { code: 'already_rejected' },
    });

    // While a request of the route runs, no edit takes its number.
    const live = await setup().start(reviewRouteId);
    expect(live.status).toBe(200);
    expect(await edit(request)).toEqual({ status: 409, body: { error: { code: 'update_live' } } });
  });
});
