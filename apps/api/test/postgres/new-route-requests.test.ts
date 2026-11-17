import { randomBytes } from 'node:crypto';
import { decideOfficialDomainsAction } from '@arca/api-contract/routes';
import { type RouteVersion, routeVersionSchema } from '@arca/domain';
import {
  type Json,
  type RuleRows,
  casesFileSchema,
  checkProposal,
  officialDomainListHash,
  versionCasesHash,
} from '@arca/knowledge';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { auditLog } from '../../src/audit/log.js';
import { credentialStore } from '../../src/auth/auth.js';
import { createStepUp } from '../../src/auth/step-up.js';
import type { AdminGrants } from '../../src/knowledge/admin-grants.js';
import { adminRole } from '../../src/knowledge/admins.js';
import type { SourceFetcher } from '../../src/knowledge/check/fetcher.js';
import { createKnowledgeDecisions } from '../../src/knowledge/decisions.js';
import { officialDomainsView } from '../../src/knowledge/official-domains.js';
import { postgresRuleStore } from '../../src/knowledge/rule-store.js';
import type { ResearchRequest, RuleResearcher } from '../../src/knowledge/update/ports.js';
import { createUpdateRequests } from '../../src/knowledge/update/requests.js';
import { createVersionReviews } from '../../src/knowledge/update/review.js';
import { createRuleUpdate } from '../../src/knowledge/update/run.js';
import { scriptedRuleValidator } from '../../src/knowledge/update/scripted.js';
import { postgresUpdateStore } from '../../src/knowledge/update/store.js';
import { noLimits } from '../limits.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';
import { decideWithStepUp, decisionStepUp } from './knowledge-decision-legacy.js';
import { origin, person, type Person } from './step-up-people.js';

// New-route requests (ADR-0031, #461) on the real migrations and the imported rules, with a
// scripted researcher and validator: no model is called. Synthetic accounts and hosts only.
let testDatabase: AuthTestDatabase;
let owner: Person;
let member: Person;
/** A stored version whose content, as a new route of its own country, passes every check. */
let known: { readonly base: RouteVersion; readonly cases: Json } | undefined;
/** A stored version whose content, moved to a country with no list, passes every check. */
let moved:
  { readonly base: RouteVersion; readonly cases: Json; readonly hosts: Json[] } | undefined;

/** The two routes beforeAll found. */
const found = () => {
  if (known === undefined || moved === undefined) throw new Error('Two passing routes expected');
  return { known, moved };
};

const newCountry = 'FR';
const registryLink = 'https://registry.example/public-bodies';

const readRules = () => {
  const store = postgresRuleStore(() => testDatabase.apiDb, silentLogger);
  return { rows: store.rows, reading: store.reading };
};

/** The host entries of the lists a version pins, as a new country's first list would hold them. */
const listedHosts = (rows: RuleRows, version: RouteVersion): Json[] =>
  version.officialDomains.flatMap((pin) => {
    const row = rows.officialDomainLists.find(
      ({ id, number }) => id === pin.id && number === pin.number,
    );
    return (row?.content as { hosts?: Json[] } | undefined)?.hosts ?? [];
  });

/** The base as the first version of a new route of a country, on the lists given. */
const firstVersion = (
  base: RouteVersion,
  country: string,
  officialDomains: RouteVersion['officialDomains'],
): Json => ({
  ...Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'corrects')),
  routeId: `${country.toLowerCase()}-synthetic-entry`,
  number: 1,
  country,
  officialDomains,
});

/** A first list for the new country, every host's proof on the registry the admin named. */
const firstList = (hosts: Json[], country = newCountry) =>
  ({
    schemaVersion: 1,
    id: country.toLowerCase(),
    number: 1,
    issuer: 'A synthetic republic',
    hosts: hosts.map((entry) => ({
      host: (entry as { host: string }).host,
      source: {
        id: `registry-${(entry as { host: string }).host.replaceAll('.', '-')}`,
        url: registryLink,
        title: 'Registry of public bodies',
        kind: 'official',
        verifiedAt: '2026-11-01',
      },
    })),
  }) as unknown as Json;

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  owner = await person(testDatabase);
  member = await person(testDatabase);
  const { rows, reading } = readRules();
  const stored = await rows();
  const newest = new Map<string, (typeof stored.routeVersions)[number]>();
  for (const row of stored.routeVersions) {
    if ((newest.get(row.routeId)?.number ?? 0) < row.number) newest.set(row.routeId, row);
  }
  for (const row of newest.values()) {
    const cases = casesFileSchema.safeParse(row.cases);
    const content = routeVersionSchema.safeParse(row.content);
    if (!cases.success || !content.success || content.data.status !== 'open') continue;
    const base = content.data;
    if (known === undefined) {
      const result = await checkProposal(
        stored,
        { kind: 'new', country: base.country, pins: base.officialDomains },
        firstVersion(base, base.country, base.officialDomains),
        row.cases,
        reading,
      );
      if (result.ok) known = { base, cases: row.cases };
    }
    if (moved === undefined) {
      const hosts = listedHosts(stored, base);
      const list = firstList(hosts);
      const result = await checkProposal(
        stored,
        {
          kind: 'new',
          country: newCountry,
          pins: [],
          list: {
            id: 'fr',
            number: 1,
            content: list,
            contentHash: officialDomainListHash(list, reading),
          },
        },
        firstVersion(base, newCountry, [{ id: 'fr', number: 1 }]),
        row.cases,
        reading,
      );
      if (result.ok) moved = { base, cases: row.cases, hosts };
    }
  }
}, 120_000);

afterAll(async () => {
  await testDatabase.drop();
});

/** Research that answers the base as a new route, and remembers what it was asked. */
function newRouteResearcher(asked: ResearchRequest[]): RuleResearcher {
  return {
    research: (request) => {
      asked.push(request);
      const country = request.newRoute?.country ?? '';
      const isNew = request.newRoute?.firstList !== undefined;
      const source = isNew ? found().moved : found().known;
      const pins = isNew ? [{ id: country.toLowerCase(), number: 1 }] : source.base.officialDomains;
      const list = isNew ? firstList(found().moved.hosts, country) : null;
      return Promise.resolve({
        reply: {
          versionJson: JSON.stringify(firstVersion(source.base, country, pins)),
          casesJson: JSON.stringify(source.cases),
          quotes: [],
          domainListJson: list === null ? '' : JSON.stringify(list),
        },
        model: 'scripted',
        promptVersion: 'scripted',
      });
    },
  };
}

/** The registry page and a page on each host of the moved route's lists: the hosts the admin names. */
const newCountryLinks = () => [
  registryLink,
  ...found().moved.hosts.map((entry) => `https://${(entry as { host: string }).host}/visas`),
];

/** Every page reads as a registry naming every host of the moved route's lists, or as `text`. */
const pagesFetcher = (text?: string): SourceFetcher => ({
  fetch: (url) =>
    Promise.resolve({
      ok: true,
      status: 200,
      text:
        text ??
        `Official bodies: ${found()
          .moved.hosts.map((entry) => (entry as { host: string }).host)
          .join(', ')}.`,
      cut: false,
      chain: [url],
    }),
});

const stepUpService = () =>
  createStepUp({
    db: testDatabase.authDb,
    credentials: credentialStore(testDatabase.authDb),
    audit: auditLog(testDatabase.auditDb),
    origin,
    logger: silentLogger,
  });

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

function setup({
  signedIn = owner,
  researcher = newRouteResearcher([]),
  fetcher = pagesFetcher(),
}: {
  readonly signedIn?: Person;
  readonly researcher?: RuleResearcher;
  readonly fetcher?: SourceFetcher;
} = {}) {
  const runs: string[] = [];
  const rules = postgresRuleStore(() => testDatabase.jobsDb, silentLogger);
  const step = createRuleUpdate({
    store: postgresUpdateStore(() => testDatabase.jobsDb),
    rows: rules.rows,
    reading: rules.reading,
    fetcher,
    researcher,
    validator: scriptedRuleValidator,
    model: () => Promise.resolve({ model: 'fake', effort: null }),
    today: () => '2026-11-17',
    logger: silentLogger,
    now: () => 0,
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
    updateRequests: createUpdateRequests({
      db: () => testDatabase.apiDb,
      role: adminRole(() => testDatabase.apiDb, [owner.signedIn.accountId]),
      audit: auditLog(testDatabase.auditDb),
      store: postgresUpdateStore(() => testDatabase.apiDb),
      ...readRules(),
      states: () => decisions().states(),
      configured: () => Promise.resolve(true),
      run: (requestId) => {
        runs.push(requestId);
        return Promise.resolve();
      },
      logger: silentLogger,
      now: () => Date.now(),
    }),
    versionReviews: createVersionReviews({
      db: () => testDatabase.apiDb,
      role: adminRole(() => testDatabase.apiDb, [owner.signedIn.accountId]),
      audit: auditLog(testDatabase.auditDb),
      store: postgresUpdateStore(() => testDatabase.apiDb),
      ...readRules(),
      states: () => decisions().states(),
      fetcher,
      today: () => '2026-11-17',
    }),
    admins: {
      isAdmin: (accountId) => Promise.resolve(accountId === owner.signedIn.accountId),
      list: () => Promise.reject(new Error('not used')),
      grant: () => Promise.reject(new Error('not used')),
      remove: () => Promise.reject(new Error('not used')),
    } satisfies AdminGrants,
  });
  const start = (body: unknown) =>
    app.request('/v1/knowledge/new-route-requests', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const listed = async () => {
    const response = await app.request('/v1/knowledge/new-route-requests');
    return { status: response.status, body: (await response.json()) as { requests: Progress[] } };
  };
  const review = async (routeId: string, number: number) => {
    const response = await app.request(
      `/v1/knowledge/versions/review?routeId=${routeId}&number=${String(number)}`,
    );
    return { status: response.status, body: (await response.json()) as Review };
  };
  const runAll = async (requestId: string) => {
    for (let index = 0; index < 5 && (await step(requestId)); index += 1);
  };
  /** Starts a request, runs it to its end and answers its progress. */
  const ask = async (body: unknown) => {
    const started = await start(body);
    expect(started.status).toBe(200);
    const { requestId } = (await started.json()) as { requestId: string };
    await runAll(requestId);
    const shown = (await listed()).body.requests.find((each) => each.requestId === requestId);
    if (shown === undefined) throw new Error('The request expected in the list');
    return shown;
  };
  const updateRequest = (routeId: string) =>
    app.request('/v1/knowledge/update-requests', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ routeId }),
    });
  return { start, listed, review, runAll, ask, runs, updateRequest };
}

interface Progress {
  requestId: string;
  country: string;
  visa: string;
  newCountry: boolean;
  state: string;
  failure: string | null;
  stages: { stage: string; state: string }[];
  proposedRouteId: string | null;
  proposedNumber: number | null;
  contentHash: string | null;
}

interface Review {
  origin: string;
  items: { key: string; list: string; reason: string | null }[];
  domainList: {
    listId: string;
    number: number;
    hash: string;
    state: string;
    hosts: { host: string; proof: { url: string } }[];
  } | null;
}

/** A list decision as the app takes one: a step-up bound to its hash, then decide. */
async function decideList(
  kind: 'activate' | 'reject',
  listId: string,
  number: number,
  hash: string,
) {
  const stepUp = stepUpService();
  const action = {
    ...decideOfficialDomainsAction(
      kind === 'activate' ? 'activateOfficialDomains' : 'rejectOfficialDomains',
      { listId, number },
      hash,
    ),
    nonce: randomBytes(16),
  };
  await decisionStepUp(stepUp, owner, action);
  return decisions().decide(
    owner.signedIn,
    kind,
    { subject: 'official_domains', listId, number },
    action.nonce,
  );
}

const refusedBy = (pattern: RegExp) => ({
  cause: { message: expect.stringMatching(pattern) as unknown },
});

/** The stored identity and cases hash of a route version. */
async function storedIdentity(routeId: string, number: number) {
  const store = postgresRuleStore(() => testDatabase.apiDb, silentLogger);
  const identity = (await store.engine()).catalog
    .identities(routeId)
    .find((each) => each.number === number);
  if (identity === undefined) throw new Error('A stored version expected');
  return { identity, casesHash: versionCasesHash(await store.data(), identity.hash) ?? '' };
}

describe('new-route requests in a country with approved lists (ADR-0031, #461)', () => {
  it('researches on the country lists, runs the cases and stores the first version as proposed', async () => {
    const asked: ResearchRequest[] = [];
    const { start, listed, ask, runs } = setup({ researcher: newRouteResearcher(asked) });
    const { country } = found().known.base;
    const onList = found().known.base.sources.find(({ kind }) => kind === 'official')?.url ?? '';
    const ended = await ask({
      country,
      visa: 'Synthetic entry visa',
      links: [onList, 'https://elsewhere.example/page'],
    });
    expect(runs).toContain(ended.requestId);
    expect(ended).toMatchObject({
      country,
      visa: 'Synthetic entry visa',
      newCountry: false,
      state: 'finished',
      failure: null,
      proposedRouteId: `${country.toLowerCase()}-synthetic-entry`,
      proposedNumber: 1,
    });
    // Research read the country's approved lists, with only the link on them, as an address.
    const [first] = asked;
    expect(first?.routeId).toBeNull();
    expect(first?.newRoute).toMatchObject({
      country,
      visa: 'Synthetic entry visa',
      links: [onList],
      listPins: found().known.base.officialDomains,
    });
    expect(first?.newRoute?.firstList).toBeUndefined();
    expect(first?.officialHosts.length).toBeGreaterThan(0);

    const stored = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ route_id: string; number: number }>(
            'SELECT route_id, number FROM knowledge.route_version WHERE request_id = $1',
            [ended.requestId],
          )
        ).rows,
    );
    expect(stored).toEqual([{ route_id: ended.proposedRouteId, number: 1 }]);

    // The proposal is a proposed version an admin reviews and activates like any other.
    const { review } = setup();
    const shown = await review(ended.proposedRouteId ?? '', 1);
    expect(shown.status).toBe(200);
    expect(shown.body).toMatchObject({ origin: 'request', domainList: null });
    const { identity, casesHash } = await storedIdentity(ended.proposedRouteId ?? '', 1);
    expect(
      await decideWithStepUp(stepUpService(), decisions(), owner, 'activate', identity, casesHash),
    ).toHaveProperty('decided');

    // The new route now exists: a second request with the same route ID is refused by code.
    const again = await setup({ researcher: newRouteResearcher([]) }).ask({
      country,
      visa: 'Synthetic entry visa',
    });
    expect(again).toMatchObject({ state: 'failed', failure: 'proposal_invalid' });
    expect((await listed()).status).toBe(200);
    expect((await start({ country, visa: 'x' })).status).toBe(400);
    // The visa goes to the model as typed, so what looks like personal data is refused.
    expect((await start({ country, visa: 'Visa for passport 12345678' })).status).toBe(400);
    expect((await start({ country, visa: 'Visa for someone@example.com' })).status).toBe(400);
  });

  it('allows one live new-route request per country, and refuses anyone but an admin', async () => {
    const { start } = setup();
    const { country } = found().known.base;
    const first = await start({ country, visa: 'Synthetic seasonal work' });
    expect(first.status).toBe(200);
    const again = await start({ country, visa: 'Another synthetic visa' });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: { code: 'update_live' } });

    const outsider = setup({ signedIn: member });
    expect((await outsider.start({ country, visa: 'Synthetic visa' })).status).toBe(403);
    expect((await outsider.listed()).status).toBe(403);
    // A code outside the country dataset is no country.
    expect((await start({ country: 'XX', visa: 'Synthetic visa' })).status).toBe(404);
  });
});

describe('new-route requests in a country with no list (ADR-0031, #461)', () => {
  it('needs a link, since research starts only on hosts the admin named', async () => {
    const response = await setup().start({ country: 'DE', visa: 'Synthetic visa' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'links_needed' } });
  });

  it('proposes the first list with the route, decided apart and before it', async () => {
    const asked: ResearchRequest[] = [];
    const { ask, review, updateRequest } = setup({ researcher: newRouteResearcher(asked) });
    const ended = await ask({
      country: newCountry,
      visa: 'Synthetic long stay',
      links: newCountryLinks(),
    });
    expect(ended).toMatchObject({ newCountry: true, state: 'finished', failure: null });
    // Research started only on the hosts the admin named, and was asked for the first list.
    expect(asked[0]?.officialHosts).toEqual(
      newCountryLinks().map((link) => new URL(link).hostname),
    );
    expect(asked[0]?.newRoute?.firstList).toEqual({ id: 'fr', number: 1 });

    const routeId = ended.proposedRouteId ?? '';
    const shown = await review(routeId, 1);
    expect(shown.status).toBe(200);
    const list = shown.body.domainList;
    expect(list).toMatchObject({ listId: 'fr', number: 1, state: 'proposed' });
    expect(list?.hosts.every(({ proof }) => proof.url === registryLink)).toBe(true);
    // Until the list is active, nothing rests on its hosts.
    expect(shown.body.items.length).toBeGreaterThan(0);
    expect(
      shown.body.items.every(
        ({ list: shownList, reason }) => shownList === 'unconfirmed' && reason === 'list_pending',
      ),
    ).toBe(true);

    const stored = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ list_id: string; content_hash: string }>(
            'SELECT list_id, content_hash FROM knowledge.official_domain_list WHERE request_id = $1',
            [ended.requestId],
          )
        ).rows,
    );
    expect(stored).toEqual([{ list_id: 'fr', content_hash: list?.hash }]);

    // The route waits for its list.
    const { identity, casesHash } = await storedIdentity(routeId, 1);
    expect(
      await decideWithStepUp(stepUpService(), decisions(), owner, 'activate', identity, casesHash),
    ).toEqual({ refused: 'list_pending' });
    // Research never runs again on hosts nobody approved.
    const updated = await updateRequest(routeId);
    expect(updated.status).toBe(409);
    expect(await updated.json()).toEqual({ error: { code: 'list_pending' } });
    // An imported list is no decision subject; a stale hash decides nothing.
    expect(await decideList('activate', 'pt', 1, 'a'.repeat(64))).toEqual({ refused: 'not_found' });
    expect(await decideList('activate', 'fr', 1, 'b'.repeat(64))).toEqual({
      refused: 'step_up_required',
    });

    expect(await decideList('activate', 'fr', 1, list?.hash ?? '')).toHaveProperty('decided');
    const after = await review(routeId, 1);
    expect(after.body.domainList?.state).toBe('active');
    expect(after.body.items.some(({ reason }) => reason === 'list_pending')).toBe(false);
    expect(
      await decideWithStepUp(stepUpService(), decisions(), owner, 'activate', identity, casesHash),
    ).toHaveProperty('decided');
    // An active list may hold up an active route, so it is never rejected.
    expect(await decideList('reject', 'fr', 1, list?.hash ?? '')).toEqual({
      refused: 'list_active',
    });
  });

  it('refuses a first list whose registry page does not name its host, even after the correction', async () => {
    const fresh = await setup({ fetcher: pagesFetcher('A registry that lists nothing.') }).ask({
      country: 'BE',
      visa: 'Synthetic visa',
      links: newCountryLinks(),
    });
    expect(fresh).toMatchObject({ newCountry: true, state: 'failed', failure: 'proposal_invalid' });
    const stages = fresh.stages.map(({ stage, state }) => `${stage}:${state}`);
    expect(stages).toEqual([
      'research:done',
      'validation:done',
      'correction:done',
      'final_validation:done',
    ]);
    // Code, not a model, found each host missing from its registry page.
    const stored = await postgresUpdateStore(() => testDatabase.apiDb).stages(fresh.requestId);
    const problems = (stored.at(-1)?.output as { problems?: string[] } | null)?.problems ?? [];
    expect(problems.length).toBe(found().moved.hosts.length);
    expect(
      problems.every((line) => /^domainList\/hosts\/\d+\/source\/url: A registry page/.test(line)),
    ).toBe(true);
  });
});

describe('knowledge.start_new_route_request (ADR-0031, #461)', () => {
  /** Calls the definer as app_api with the account set, in a transaction rolled back after. */
  const call = (
    accountId: string | null,
    basis: string,
    grantId: string | null,
    pins: string[] = [],
  ) =>
    testDatabase.asAdmin(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE app_api');
        if (accountId !== null) {
          await client.query(`SELECT set_config('app.account_id', $1, true)`, [accountId]);
        }
        const { rows } = await client.query<{ id: string | null }>(
          `SELECT knowledge.start_new_route_request('IT', 'Synthetic visa', '{}', $1, $2, $3::uuid)
             AS id`,
          [pins, basis, grantId],
        );
        return rows[0]?.id ?? null;
      } catch (error) {
        return (error as { code?: string }).code ?? 'error';
      } finally {
        await client.query('ROLLBACK');
      }
    });

  it('refuses anyone the admin basis does not hold for, and a pin that is no pin', async () => {
    expect(await call(null, 'owner_list', null)).toBe('42501');
    expect(await call(member.signedIn.accountId, 'grant', member.signedIn.accountId)).toBe('42501');
    expect(await call(owner.signedIn.accountId, 'nonsense', null)).toBe('42501');
    // The shape check refuses a malformed pin: 23514 is check_violation.
    expect(await call(owner.signedIn.accountId, 'owner_list', null, ['../it'])).toBe('23514');
    expect(await call(owner.signedIn.accountId, 'owner_list', null, ['it/1'])).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});

describe('what the database lets app_jobs store for a new route (ADR-0031, #461)', () => {
  it('refuses a first list or a version a new-route request did not end with', async () => {
    const { start } = setup();
    const started = await start({
      country: 'ES',
      visa: 'Synthetic visa',
    });
    const { requestId } = (await started.json()) as { requestId: string };
    const list = firstList(found().moved.hosts);
    const hash = officialDomainListHash(list, readRules().reading);
    // No end yet: neither row may be stored.
    const content = JSON.stringify({ ...(list as object), id: 'es', number: 99 });
    await expect(
      testDatabase.jobsDb.execute(sql`
        INSERT INTO knowledge.official_domain_list (list_id, number, content, content_hash,
                                                    request_id)
        VALUES ('es', 99, ${content}::jsonb, ${hash}, ${requestId})`),
    ).rejects.toMatchObject(refusedBy(/row-level security/));
    await expect(
      testDatabase.jobsDb.execute(sql`
        INSERT INTO knowledge.route_version (route_id, number, content, content_hash, request_id)
        VALUES ('es-forged', 1, '{"routeId":"es-forged","number":1}'::jsonb, ${'c'.repeat(64)},
                ${requestId})`),
    ).rejects.toMatchObject(refusedBy(/row-level security/));
  });
});
