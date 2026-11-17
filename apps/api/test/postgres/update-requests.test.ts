import { checkItems, routeVersionSchema } from '@arca/domain';
import { casesFileSchema } from '@arca/knowledge';
import { bundledRuleData, ruleContent } from '@arca/knowledge/bundled';
import { createLogger } from '@arca/telemetry';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { auditLog } from '../../src/audit/log.js';
import { adminRole } from '../../src/knowledge/admins.js';
import { offlineFetcher } from '../../src/knowledge/check/environment.js';
import { postgresRuleStore } from '../../src/knowledge/rule-store.js';
import {
  RuleResearcherError,
  type RuleResearcher,
  type RuleValidator,
} from '../../src/knowledge/update/ports.js';
import type { SourceFetcher } from '../../src/knowledge/check/fetcher.js';
import { createUpdateRequests, updateLiveMs } from '../../src/knowledge/update/requests.js';
import { createRuleUpdate } from '../../src/knowledge/update/run.js';
import {
  scriptedRuleResearcher,
  scriptedRuleValidator,
} from '../../src/knowledge/update/scripted.js';
import { postgresUpdateStore } from '../../src/knowledge/update/store.js';
import { noLimits } from '../limits.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';
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
  const [first, second, third, fourth] = passing;
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) {
    throw new Error('Four routes expected');
  }
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
    configured: () => Promise.resolve(configured),
    run: (requestId) => {
      if (runFails) return Promise.reject(new Error('workflow down'));
      runs.push(requestId);
      return Promise.resolve();
    },
    logger: createLogger((line) => logLines.push(line)),
    now: () => Date.now() + later,
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
  });
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
  return { start, progress, runAll, runs };
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
