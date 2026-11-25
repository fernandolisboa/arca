import { randomUUID } from 'node:crypto';
import type { FamilyPlan } from '@arca/api-contract/routes';
import { type DecisionState, identityKey, parseCalendarDate } from '@arca/domain';
import { comparisonCatalog } from '@arca/knowledge';
import { routeCatalog, routeIds } from '@arca/knowledge/bundled';
import type { Logger } from '@arca/telemetry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { auditLog } from '../../src/audit/log.js';
import { type CaseFiles, createCaseFiles } from '../../src/case/case-files.js';
import { planRevision } from '../../src/case/plan.js';
import { noLimits } from '../limits.js';
import { authTestDatabase, type AuthTestDatabase } from './auth-database.js';

// The family plan's routes (ADR-0040) through the app, on the real migrations as app_api, with
// the bundled routes. Synthetic people only.
let testDatabase: AuthTestDatabase;

const origin = 'http://arca.test';
const route = 'pt-d8';
const other = 'pt-d7';

const routesActive: [string, DecisionState][] = routeIds.flatMap((routeId) =>
  routeCatalog.identities(routeId).map((identity) => [identityKey(identity), 'active' as const]),
);

function setup() {
  const logged: unknown[] = [];
  const limited: string[] = [];
  const logger: Logger = {
    info: (entry) => logged.push(entry),
    error: (entry) => logged.push(entry),
  };
  let caller = '';
  const cases: CaseFiles = createCaseFiles({
    db: () => testDatabase.apiDb,
    audit: auditLog(testDatabase.auditDb),
    today: () => new Date('2026-11-25T12:00:00Z'),
    countries: { countries: ['BR', 'PT', 'US'], formerCountries: [] },
    occupations: ['2211', '2512'],
    studyFields: ['0613', '0912'],
    evaluation: {
      rules: () => Promise.resolve({ catalog: routeCatalog, routeIds }),
      comparisons: comparisonCatalog,
      states: () => Promise.resolve(new Map(routesActive)),
      today: () => parseCalendarDate('2026-11-25'),
      engineCommit: 'test',
    },
  });
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve({ accountId: caller, sessionId: randomUUID() }),
      refresh: () =>
        Promise.resolve({
          session: {
            accountId: caller,
            email: 'member@example.com',
            confirmed: true,
            device: { browser: 'firefox' as const, os: 'linux' as const },
          },
          setCookies: [],
        }),
    },
    authLimits: {
      ...noLimits,
      limiter: {
        hit: (rule) => {
          limited.push(rule.name);
          return Promise.resolve({ allowed: true });
        },
      },
    },
    cases,
    accountConfirmed: () => Promise.resolve(true),
  });
  const call = async (account: string, method: 'GET' | 'PUT', body?: unknown) => {
    caller = account;
    return app.request('/v1/case/plan', {
      method,
      headers: { origin, cookie: 'session=1', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  const plan = async (account: string) => {
    const response = await call(account, 'GET');
    expect(response.status).toBe(200);
    return (await response.json()) as FamilyPlan;
  };
  return { cases, call, plan, logged, limited };
}

beforeAll(async () => {
  testDatabase = await authTestDatabase();
});

afterAll(async () => {
  await testDatabase.drop();
});

async function account() {
  const accountId = randomUUID();
  await testDatabase.asAdmin((client) =>
    client.query(`INSERT INTO auth.user (id, name, email) VALUES ($1, '', $2)`, [
      accountId,
      `${accountId}@example.com`,
    ]),
  );
  return accountId;
}

/** Alice's case with Bruno as a member and a grandmother Alice describes, outside the planning. */
async function family(cases: CaseFiles) {
  const alice = await account();
  const bruno = await account();
  const created = await cases.create(alice, 'Alice');
  if (!created.ok) throw new Error(created.reason);
  await testDatabase.asAdmin((client) =>
    client.query(`INSERT INTO account.link (inviter_id, invitee_id) VALUES ($1, $2)`, [
      alice,
      bruno,
    ]),
  );
  const joined = await cases.addMember(alice, { accountId: bruno, displayName: 'Bruno' });
  if (!joined.ok) throw new Error(joined.reason);
  const added = await cases.addPerson(alice, { displayName: 'Avó', caseMember: false });
  if (!added.ok) throw new Error(added.reason);
  const id = (name: string) => {
    const found = added.view.people.find(({ displayName }) => displayName === name)?.id;
    if (found === undefined) throw new Error(`no ${name}`);
    return found;
  };
  return { alice, bruno, ids: { alice: id('Alice'), bruno: id('Bruno'), grandma: id('Avó') } };
}

/** The revision of a plan nobody has written yet. */
const empty = planRevision([]);

type Ids = Awaited<ReturnType<typeof family>>['ids'];

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('the family plan (ADR-0040)', () => {
  it('starts empty, with every member still to place', async () => {
    const { cases, plan, limited } = setup();
    const { alice, ids } = await family(cases);
    const answer = await plan(alice);
    expect(answer.moves).toEqual([]);
    expect(new Set(answer.unplanned)).toEqual(new Set([ids.alice, ids.bruno]));
    expect(answer.totals).toEqual([]);
    expect(limited).toEqual(['case_plan_session']);
  });

  it('stores moves any member reads back, by stage, each evaluated with only who it takes', async () => {
    const { cases, call, plan, limited } = setup();
    const { alice, bruno, ids } = await family(cases);
    const moves = [
      { stage: 2, routeId: other, principalId: ids.bruno, dependentIds: [] },
      { stage: 1, routeId: route, principalId: ids.alice, dependentIds: [ids.grandma] },
    ];
    const written = await call(alice, 'PUT', { revision: empty, moves });
    expect(written.status).toBe(200);
    expect(limited).toEqual(['case_write_account']);
    const seen = await plan(bruno);
    expect(
      seen.moves.map(({ stage, result }) => [stage, result.routeId, result.principalId]),
    ).toEqual([
      [1, route, ids.alice],
      [2, other, ids.bruno],
    ]);
    const [first] = seen.moves;
    // Bruno is Alice's spouse in no relationship, and the rule leaves the grandmother out too.
    expect(first?.dependents).toEqual([{ personId: ids.grandma, fit: 'not_covered' }]);
    expect(seen.moves.map(({ principalGoesFrom }) => principalGoesFrom)).toEqual([null, null]);
    expect(first?.result.dependents).toEqual([]);
    expect(seen.unplanned).toEqual([]);
  });

  it('replaces the whole plan on each write', async () => {
    const { cases, call, plan } = setup();
    const { alice, ids } = await family(cases);
    const one = { stage: 1, routeId: route, principalId: ids.alice, dependentIds: [ids.bruno] };
    const first = await call(alice, 'PUT', { revision: empty, moves: [one] });
    expect(first.status).toBe(200);
    const { revision } = (await first.json()) as FamilyPlan;
    expect((await call(alice, 'PUT', { revision, moves: [] })).status).toBe(200);
    expect((await plan(alice)).moves).toEqual([]);
  });

  it('refuses a write over a plan it did not see, so no member loses another’s edit', async () => {
    const { cases, call, plan } = setup();
    const { alice, bruno, ids } = await family(cases);
    const seenByBruno = (await plan(bruno)).revision;
    const aliceMove = { stage: 1, routeId: route, principalId: ids.alice, dependentIds: [] };
    expect((await call(alice, 'PUT', { revision: empty, moves: [aliceMove] })).status).toBe(200);
    const brunoMove = { stage: 2, routeId: other, principalId: ids.bruno, dependentIds: [] };
    const stale = await call(bruno, 'PUT', { revision: seenByBruno, moves: [brunoMove] });
    expect(stale.status).toBe(409);
    expect(await errorOf(stale)).toBe('plan_changed');
    expect((await plan(bruno)).moves.map(({ result }) => result.principalId)).toEqual([ids.alice]);
  });

  it.each<[string, (ids: Ids) => unknown[]]>([
    [
      'a principal outside the planning',
      (ids) => [{ stage: 1, routeId: route, principalId: ids.grandma, dependentIds: [] }],
    ],
    [
      'an unknown route',
      (ids) => [{ stage: 1, routeId: 'pt-missing', principalId: ids.alice, dependentIds: [] }],
    ],
    [
      'someone outside the case',
      (ids) => [{ stage: 1, routeId: route, principalId: ids.alice, dependentIds: [randomUUID()] }],
    ],
    [
      'one route twice for one principal',
      (ids) => [
        { stage: 1, routeId: route, principalId: ids.alice, dependentIds: [] },
        { stage: 2, routeId: route, principalId: ids.alice, dependentIds: [] },
      ],
    ],
  ])('refuses %s', async (_label, moves) => {
    const { cases, call, plan } = setup();
    const { alice, ids } = await family(cases);
    const response = await call(alice, 'PUT', { revision: empty, moves: moves(ids) });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('case_invalid');
    expect((await plan(alice)).moves).toEqual([]);
  });

  it('refuses a stage out of range before reaching the case', async () => {
    const { cases, call } = setup();
    const { alice, ids } = await family(cases);
    const response = await call(alice, 'PUT', {
      revision: empty,
      moves: [{ stage: 7, routeId: route, principalId: ids.alice, dependentIds: [] }],
    });
    expect(response.status).toBe(400);
  });

  it('drops the moves of a person who leaves the case, and what they were taken in', async () => {
    const { cases, call, plan } = setup();
    const { alice, ids } = await family(cases);
    const moves = [
      { stage: 1, routeId: route, principalId: ids.alice, dependentIds: [ids.grandma] },
    ];
    expect((await call(alice, 'PUT', { revision: empty, moves })).status).toBe(200);
    const removed = await cases.removePerson(alice, ids.grandma);
    expect(removed.ok).toBe(true);
    const [move] = (await plan(alice)).moves;
    expect(move?.dependents).toEqual([]);
  });

  it('answers 404 outside a case', async () => {
    const { call } = setup();
    const stranger = await account();
    expect((await call(stranger, 'GET')).status).toBe(404);
    expect((await call(stranger, 'PUT', { revision: empty, moves: [] })).status).toBe(404);
  });
});
