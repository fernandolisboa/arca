import { randomUUID } from 'node:crypto';
import type { DestinationComparison } from '@arca/api-contract/routes';
import {
  type ComparisonCatalog,
  type DecisionState,
  comparedCountries,
  comparisonIdentityKey,
  identityKey,
  parseCalendarDate,
} from '@arca/domain';
import { comparisonCatalog, routeCatalog, routeIds } from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { auditLog } from '../../src/audit/log.js';
import { type CaseFiles, createCaseFiles } from '../../src/case/case-files.js';
import { noLimits } from '../limits.js';
import { authTestDatabase, type AuthTestDatabase } from './auth-database.js';

// The destination comparison's routes (ADR-0026, #315) through the app, on the real migrations as
// app_api, with the bundled catalogs. Synthetic people and criterion names only.
let testDatabase: AuthTestDatabase;

const origin = 'http://arca.test';
const [bundled] = comparisonCatalog.identities();
if (bundled === undefined) throw new Error('no comparison version is bundled');

const routesActive: [string, DecisionState][] = routeIds.flatMap((routeId) =>
  routeCatalog.identities(routeId).map((identity) => [identityKey(identity), 'active' as const]),
);
const comparisonActive: [string, DecisionState] = [comparisonIdentityKey(bundled), 'active'];

/** The bundled catalog with a newer version that exists only as an identity, still proposed. */
const withNewerProposed: ComparisonCatalog = {
  identities: () => [
    ...comparisonCatalog.identities(),
    { ...bundled, number: bundled.number + 1, hash: 'b'.repeat(64) },
  ],
  activeEntry: (identity, states) => comparisonCatalog.activeEntry(identity, states),
};

interface Setup {
  readonly states?: readonly [string, DecisionState][];
  readonly comparisons?: ComparisonCatalog;
}

function setup({ states = [...routesActive, comparisonActive], comparisons }: Setup = {}) {
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
    today: () => new Date('2026-11-07T12:00:00Z'),
    countries: { countries: ['BR', 'PT', 'US'], formerCountries: [] },
    evaluation: {
      catalog: routeCatalog,
      routeIds,
      comparisons: comparisons ?? comparisonCatalog,
      states: () => Promise.resolve(new Map(states)),
      today: () => parseCalendarDate('2026-11-07'),
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
  const call = async (account: string, method: 'GET' | 'PUT', path: string, body?: unknown) => {
    caller = account;
    return app.request(`/v1${path}`, {
      method,
      headers: { origin, cookie: 'session=1', 'content-type': 'application/json' },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
  };
  const comparison = async (account: string) => {
    const response = await call(account, 'GET', '/comparison');
    expect(response.status).toBe(200);
    return (await response.json()) as DestinationComparison;
  };
  const write = (account: string, preferences: unknown) =>
    call(account, 'PUT', '/comparison/preferences', preferences);
  return { cases, call, comparison, write, logged, limited };
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

/** Alice's case with Bruno as a member. */
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
  return { alice, bruno };
}

const nothingChosen = { weights: {}, ratings: {}, ownCriteria: [], hidden: [] };
const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('the destination comparison (ADR-0026, #315)', () => {
  it('ranks every country with a route from the default weights before anything is chosen', async () => {
    const { cases, comparison, limited } = setup();
    const { alice } = await family(cases);
    const answer = await comparison(alice);
    expect(answer.version).toEqual({ comparisonId: 'destinations', number: bundled.number });
    expect(answer.pendingNewer).toBe(false);
    expect(answer.preferences).toEqual(nothingChosen);
    expect(answer.criteria.find(({ id }) => id === 'safety')).toMatchObject({
      id: 'safety',
      kind: 'indicator',
      weight: 4,
      defaultWeight: 4,
    });
    expect(answer.countries.map(({ country }) => country).sort()).toEqual(
      comparedCountries(routeIds),
    );
    expect(answer.countries.every(({ group }) => group !== 'hidden')).toBe(true);
    const ranked = answer.countries.filter(({ group }) => group === 'ranked');
    expect(ranked.map(({ rank }) => rank)).toEqual(ranked.map((_, index) => index + 1));
    expect(limited).toEqual(['case_comparison_session']);
  });

  it('shows beside each country the best status of the caller’s own routes, not the score', async () => {
    const active = setup();
    const { alice } = await family(active.cases);
    const answer = await active.comparison(alice);
    expect(answer.countries.every(({ routeStatus }) => routeStatus !== null)).toBe(true);
    expect(answer.countries.some(({ routeStatus }) => routeStatus === 'pending_activation')).toBe(
      false,
    );

    const inactive = setup({ states: [comparisonActive] });
    const pending = await inactive.comparison(alice);
    expect(new Set(pending.countries.map(({ routeStatus }) => routeStatus))).toEqual(
      new Set(['pending_activation']),
    );
    const scores = (each: DestinationComparison) =>
      each.countries.map(({ country, total, coverage }) => ({ country, total, coverage }));
    expect(scores(pending)).toEqual(scores(answer));
  });

  it('saves the caller’s preferences, names a new own criterion and answers the new ranking', async () => {
    const { cases, write, comparison, limited } = setup();
    const { alice } = await family(cases);
    const response = await write(alice, {
      weights: { safety: 5, climate: 0 },
      ratings: { climate: { PT: 5 } },
      ownCriteria: [{ name: 'Perto da praia' }],
      hidden: ['US'],
    });
    expect(response.status).toBe(200);
    const written = (await response.json()) as DestinationComparison;
    const [own] = written.preferences.ownCriteria;
    expect(own?.id).toMatch(/^own-[0-9a-f]{8}$/);
    expect(written.criteria.at(-1)).toEqual({
      id: own?.id,
      kind: 'own',
      name: 'Perto da praia',
      weight: 3,
      defaultWeight: 3,
    });
    expect(written.criteria.find(({ id }) => id === 'safety')?.weight).toBe(5);
    expect(written.countries.at(-1)).toMatchObject({ country: 'US', group: 'hidden', rank: null });
    expect(
      written.countries
        .find(({ country }) => country === 'PT')
        ?.scores.find(({ criterion }) => criterion === 'climate'),
    ).toEqual({ criterion: 'climate', score: '10', rating: 5 });
    expect(limited).toEqual(['case_write_account']);

    const id = own?.id ?? '';
    const rated = await write(alice, {
      ...written.preferences,
      weights: { ...written.preferences.weights, [id]: 5 },
      ratings: { ...written.preferences.ratings, [id]: { PT: 4 } },
    });
    expect(rated.status).toBe(200);
    const read = await comparison(alice);
    expect(read.preferences).toEqual({
      weights: { safety: 5, climate: 0, [id]: 5 },
      ratings: { climate: { PT: 5 }, [id]: { PT: 4 } },
      ownCriteria: [{ id, name: 'Perto da praia' }],
      hidden: ['US'],
    });

    const deleted = await write(alice, { ...read.preferences, ownCriteria: [] });
    expect(((await deleted.json()) as DestinationComparison).preferences).toEqual({
      weights: { safety: 5, climate: 0 },
      ratings: { climate: { PT: 5 } },
      ownCriteria: [],
      hidden: ['US'],
    });
  });

  it('keeps each member’s preferences to themselves', async () => {
    const { cases, write, comparison } = setup();
    const { alice, bruno } = await family(cases);
    expect((await write(alice, { ...nothingChosen, weights: { safety: 0 } })).status).toBe(200);
    expect((await comparison(bruno)).preferences).toEqual(nothingChosen);
    expect((await comparison(alice)).preferences.weights).toEqual({ safety: 0 });
  });

  it('answers 404 outside a case', async () => {
    const { call, write } = setup();
    const outsider = await account();
    const read = await call(outsider, 'GET', '/comparison');
    expect(read.status).toBe(404);
    const written = await write(outsider, nothingChosen);
    expect(written.status).toBe(404);
    expect(
      await testDatabase.asAdmin(
        async (client) =>
          (
            await client.query('SELECT 1 FROM cases.comparison_preferences WHERE account_id = $1', [
              outsider,
            ])
          ).rowCount,
      ),
    ).toBe(0);
  });

  it.each<[string, unknown, number, string]>([
    ['a weight above 5', { ...nothingChosen, weights: { safety: 6 } }, 400, 'invalid_request'],
    [
      'a rating of 0',
      { ...nothingChosen, ratings: { climate: { PT: 0 } } },
      400,
      'invalid_request',
    ],
    [
      'too many own criteria',
      { ...nothingChosen, ownCriteria: Array.from({ length: 31 }, () => ({ name: 'Praia' })) },
      400,
      'invalid_request',
    ],
    [
      'a name over 60 characters',
      { ...nothingChosen, ownCriteria: [{ name: 'x'.repeat(61) }] },
      400,
      'invalid_request',
    ],
    ['an unknown field', { ...nothingChosen, shared: true }, 400, 'invalid_request'],
    [
      'an own criterion ID the caller does not have',
      { ...nothingChosen, ownCriteria: [{ id: 'own-0000beef', name: 'Praia' }] },
      409,
      'case_invalid',
    ],
    [
      'a body over 256 KiB',
      JSON.stringify({ ...nothingChosen, pad: 'x'.repeat(262_144) }),
      413,
      'too_large',
    ],
  ])('refuses %s', async (_name, body, status, code) => {
    const { cases, write, comparison } = setup();
    const { alice } = await family(cases);
    const response = await write(alice, body);
    expect(response.status).toBe(status);
    expect(await errorOf(response)).toBe(code);
    expect((await comparison(alice)).preferences).toEqual(nothingChosen);
  });

  it('takes the most a person may choose', async () => {
    const { cases, write } = setup();
    const { alice } = await family(cases);
    const criteria = Array.from(
      { length: 100 },
      (_, index) => `criterion-${String(index).padStart(3, '0')}-${'x'.repeat(50)}`,
    );
    const countries = Array.from(
      { length: 20 },
      (_, index) => `Q${String.fromCharCode(65 + index)}ZZ`,
    );
    const response = await write(alice, {
      weights: Object.fromEntries(criteria.map((id) => [id, 5])),
      ratings: Object.fromEntries(
        criteria.map((id) => [id, Object.fromEntries(countries.map((country) => [country, 5]))]),
      ),
      ownCriteria: Array.from({ length: 30 }, () => ({ name: '🏖'.repeat(30) })),
      hidden: Array.from(
        { length: 300 },
        (_, index) =>
          `${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`,
      ),
    });
    expect(response.status).toBe(200);
  });

  it('says when a newer comparison version waits for activation', async () => {
    const { cases, comparison } = setup({ comparisons: withNewerProposed });
    const { alice } = await family(cases);
    const answer = await comparison(alice);
    expect(answer.pendingNewer).toBe(true);
    expect(answer.version?.number).toBe(bundled.number);
  });

  it('scores only own criteria while no comparison version is active', async () => {
    const { cases, write } = setup({ states: routesActive });
    const { alice } = await family(cases);
    const response = await write(alice, { ...nothingChosen, ownCriteria: [{ name: 'Praia' }] });
    const answer = (await response.json()) as DestinationComparison;
    expect(answer.version).toBeNull();
    expect(answer.pendingNewer).toBe(true);
    expect(answer.criteria.map(({ kind }) => kind)).toEqual(['own']);
  });

  it('never logs the name of an own criterion', async () => {
    const { cases, write, comparison, logged } = setup();
    const { alice } = await family(cases);
    const name = 'Perto da praia sintética';
    await write(alice, { ...nothingChosen, ownCriteria: [{ name }] });
    await write(alice, { ...nothingChosen, ownCriteria: [{ name }], weights: { safety: 9 } });
    await comparison(alice);
    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged)).not.toContain(name);
  });
});
