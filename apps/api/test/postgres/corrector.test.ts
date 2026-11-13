import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { stepUpNonceHeader } from '@arca/api-contract/routes';
import {
  identityKey,
  parseCalendarDate,
  type DecisionStates,
  type VersionIdentity,
} from '@arca/domain';
import { withIdentity } from '@arca/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { auditLog } from '../../src/audit/log.js';
import { accounts, credentialStore } from '../../src/auth/auth.js';
import type { RateLimiter } from '../../src/auth/rate-limit.js';
import { createStepUp } from '../../src/auth/step-up.js';
import { adminRole } from '../../src/knowledge/admins.js';
import { createCorrections } from '../../src/knowledge/corrections.js';
import { createCorrector } from '../../src/knowledge/corrector.js';
import { memoryObjectStorage, type MemoryObjectStorage } from '../../src/storage/object-storage.js';
import { noLimits } from '../limits.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';
import { ceremony, origin, person, toRequest, type Person } from './step-up-people.js';

// The corrector key and the corrector run's routes on the real migrations (ADR-0029). Synthetic
// data only.
let testDatabase: AuthTestDatabase;
let stepUp: ReturnType<typeof createStepUp>;
let owner: Person;
let granted: Person;
let member: Person;
let states: DecisionStates;
let notices: string[];
let objects: MemoryObjectStorage;

const identity = (number: number, corrects?: number): VersionIdentity => ({
  routeId: 'qm-sample',
  number,
  effectiveFrom: parseCalendarDate('2026-01-01'),
  ...(corrects === undefined ? {} : { corrects }),
  status: 'open',
  hash: String(number).repeat(64),
});
/** v1; v2 corrects v1; v3 follows; v4 corrects v3. */
const identities = [identity(1), identity(2, 1), identity(3), identity(4, 3)];
/** A route a corrector run wrote from a request for a new route in the same country. */
const newRoute = { ...identity(1), routeId: 'qm-new' };

interface Options {
  readonly signedIn?: Person | null;
  readonly limiter?: Pick<RateLimiter, 'hit'>;
  readonly ownerList?: readonly string[];
}

function setup({ signedIn = owner, limiter = noLimits.limiter, ownerList }: Options = {}) {
  const role = adminRole(() => testDatabase.apiDb, ownerList ?? [owner.signedIn.accountId]);
  const versions = {
    view: () => Promise.resolve(undefined),
    identities: (routeId: string) =>
      routeId === 'qm-sample' ? identities : routeId === 'qm-new' ? [newRoute] : [],
    officialHosts: () => [],
  };
  const { keys, corrector } = createCorrector({
    db: () => testDatabase.apiDb,
    role,
    accountConfirmed: (accountId) => accounts.isConfirmed(testDatabase.authDb, accountId),
    stepUp,
    versions,
    states: () => Promise.resolve(states),
    audit: auditLog(testDatabase.auditDb),
    notify: (accountId, kind) => {
      notices.push(`${accountId}:${kind}`);
      return Promise.resolve();
    },
    storage: objects,
  });
  const corrections = createCorrections({
    db: () => testDatabase.apiDb,
    role,
    versions,
    states: () => Promise.resolve(states),
    countries: ['QM', 'LT'],
    audit: auditLog(testDatabase.auditDb),
    notify: () => Promise.resolve(),
    storage: objects,
  });
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(signedIn?.signedIn ?? null),
      refresh: () => Promise.resolve({ session: null, setCookies: [] }),
    },
    authLimits: { ...noLimits, limiter },
    corrections,
    correctorKeys: keys,
    corrector,
  });
  const json = { origin, 'content-type': 'application/json' };
  const asCorrector = (key: string | undefined) =>
    key === undefined ? {} : { authorization: `Bearer ${key}` };
  return {
    keyStatus: () => app.request('/v1/knowledge/corrector-key'),
    createKey: (nonce?: Uint8Array) =>
      app.request('/v1/knowledge/corrector-key', {
        method: 'POST',
        headers: {
          origin,
          ...(nonce === undefined
            ? {}
            : { [stepUpNonceHeader]: Buffer.from(nonce).toString('base64url') }),
        },
      }),
    revokeKey: (id: string) =>
      app.request('/v1/knowledge/corrector-key/revoke', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ id }),
      }),
    listRequests: (key?: string, site?: string) =>
      app.request('/v1/corrector/requests', {
        headers: { ...asCorrector(key), ...(site === undefined ? {} : { 'sec-fetch-site': site }) },
      }),
    listFlagged: (key?: string) =>
      app.request('/v1/corrector/flagged', { headers: asCorrector(key) }),
    fileUrl: (key: string, requestId: string, position: number) =>
      app.request('/v1/corrector/files/url', {
        method: 'POST',
        headers: { ...json, ...asCorrector(key) },
        body: JSON.stringify({ requestId, position }),
      }),
    answer: (key: string | undefined, requestId: string, answer: unknown) =>
      app.request('/v1/corrector/requests/answer', {
        method: 'POST',
        headers: { ...json, ...asCorrector(key) },
        body: JSON.stringify({ requestId, answer }),
      }),
    listAdmin: (number = 1) =>
      app.request(`/v1/knowledge/corrections?routeId=qm-sample&number=${String(number)}`),
    listRouteRequests: () => app.request('/v1/knowledge/route-requests'),
  };
}

/** A confirmed account with a passkey and a session. */
async function confirmed(): Promise<Person> {
  const someone = await person(testDatabase);
  await testDatabase.asAdmin((client) =>
    client.query('UPDATE auth.user SET confirmed_at = now() WHERE id = $1', [
      someone.signedIn.accountId,
    ]),
  );
  return someone;
}

/** Verifies a `corrector_key` step-up of `actor`; answers its nonce. */
async function approveKey(actor: Person) {
  const nonce = new Uint8Array(randomBytes(16));
  const { verified } = await ceremony(
    stepUp,
    actor,
    toRequest('corrector_key', { action: 'createCorrectorKey', targets: [], nonce }),
  );
  expect(verified).toBe(true);
  return nonce;
}

/** Makes a key as the owner through the route; answers it. */
async function newKey(): Promise<string> {
  const response = await setup().createKey(await approveKey(owner));
  expect(response.status).toBe(200);
  return ((await response.json()) as { key: string }).key;
}

/** A request filed by the owner, `minutesAgo` before now, with a link and a file source. */
async function filed(minutesAgo = 0, version = 1): Promise<string> {
  const id = randomUUID();
  const uploadId = randomUUID();
  const pathname = `corrections/${randomUUID()}`;
  await testDatabase.asAdmin(async (client) => {
    await client.query(
      `INSERT INTO knowledge.correction_request (id, route_id, version_number, item_kind, item_key, note, author_account_id, created_at)
       VALUES ($1, 'qm-sample', $2, 'requirement', 'income', 'O valor mudou.', $3, now() - make_interval(mins => $4))`,
      [id, version, owner.signedIn.accountId, minutesAgo],
    );
    await client.query(
      `INSERT INTO knowledge.correction_upload (id, author_account_id, pathname, media_type, size, sha256)
       VALUES ($1, $2, $3, 'application/pdf', 19, $4)`,
      [uploadId, owner.signedIn.accountId, pathname, randomBytes(32)],
    );
    await client.query(
      `INSERT INTO knowledge.correction_source (request_id, position, kind, url)
       VALUES ($1, 0, 'link', 'https://example.gov/lei')`,
      [id],
    );
    await client.query(
      `INSERT INTO knowledge.correction_source (request_id, position, kind, upload_id) VALUES ($1, 1, 'file', $2)`,
      [id, uploadId],
    );
  });
  return id;
}

/** A request for a new route in country `qm`, filed by the owner, with a passage and its page. */
async function filedNewRoute(): Promise<string> {
  const id = randomUUID();
  await testDatabase.asAdmin(async (client) => {
    await client.query(
      `INSERT INTO knowledge.correction_request (id, country_code, item_kind, note, author_account_id)
       VALUES ($1, 'qm', 'newRoute', 'Visto de trabalho temporário.', $2)`,
      [id, owner.signedIn.accountId],
    );
    await client.query(
      `INSERT INTO knowledge.correction_source (request_id, position, kind, text, url)
       VALUES ($1, 0, 'text', 'A taxa é de 120 euros.', 'https://example.gov/fees')`,
      [id],
    );
  });
  return id;
}

const auditCodes = (code: string) =>
  testDatabase.asAdmin(
    async (client) =>
      (
        await client.query<{ subject: string; actor: string | null; details: unknown }>(
          `SELECT subject_account_id AS subject, actor_account_id AS actor, details
             FROM audit.event WHERE code = $1 ORDER BY time, id`,
          [code],
        )
      ).rows,
  );

const listedIds = async (key: string) => {
  const response = await setup().listRequests(key);
  expect(response.status).toBe(200);
  return ((await response.json()) as { requests: { id: string; state: string }[] }).requests;
};

const decided = (entries: Record<number, 'active' | 'rejected'>): DecisionStates =>
  new Map(
    Object.entries(entries).map(([number, state]) => {
      const found = identities.find((version) => version.number === Number(number));
      if (found === undefined) throw new Error('unknown version');
      return [identityKey(found), state] as const;
    }),
  );

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  const { authDb, auditDb } = testDatabase;
  stepUp = createStepUp({
    db: authDb,
    credentials: credentialStore(authDb),
    audit: auditLog(auditDb),
    origin,
    logger: silentLogger,
  });
  owner = await confirmed();
  granted = await confirmed();
  member = await confirmed();
});

afterAll(async () => {
  await testDatabase.drop();
});

beforeEach(async () => {
  states = new Map();
  notices = [];
  objects = memoryObjectStorage();
  await testDatabase.asAdmin(async (client) => {
    await client.query(
      'TRUNCATE knowledge.correction_request, knowledge.correction_upload, knowledge.corrector_key, knowledge.admin_grant, audit.event CASCADE',
    );
    await client.query(
      `INSERT INTO knowledge.admin_grant (kind, grantee_account_id, actor_account_id, actor_basis, step_up_id)
       VALUES ('grant', $1, $2, 'owner_list', $3)`,
      [granted.signedIn.accountId, owner.signedIn.accountId, randomUUID()],
    );
  });
});

describe('the corrector key (ADR-0029)', () => {
  it('is made once with a corrector_key step-up, kept as its SHA-256, audited and told to the owners', async () => {
    const response = await setup().createKey(await approveKey(owner));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { key, expiresAt } = (await response.json()) as { key: string; expiresAt: string };
    expect(key).toMatch(/^arca_ck_[A-Za-z0-9_-]{43}$/);
    const stored = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ id: string; key_sha256: Buffer; actor_account_id: string }>(
            'SELECT id, key_sha256, actor_account_id FROM knowledge.corrector_key',
          )
        ).rows,
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.key_sha256.equals(createHash('sha256').update(key).digest())).toBe(true);
    expect(stored[0]?.actor_account_id).toBe(owner.signedIn.accountId);
    expect(await auditCodes('corrector_key_created')).toEqual([
      {
        subject: owner.signedIn.accountId,
        actor: owner.signedIn.accountId,
        details: { keyId: stored[0]?.id },
      },
    ]);
    expect(notices).toEqual([`${owner.signedIn.accountId}:corrector_key_changed`]);
    const status = (await (await setup().keyStatus()).json()) as {
      canManage: boolean;
      key: { id: string; expiresAt: string };
    };
    expect(status.canManage).toBe(true);
    expect(status.key.id).toBe(stored[0]?.id);
    expect(new Date(status.key.expiresAt).getTime()).toBeGreaterThanOrEqual(
      new Date(expiresAt).getTime() - 60_000,
    );
  });

  it('needs the step-up, and spends it once', async () => {
    const routes = setup();
    expect((await routes.createKey()).status).toBe(403);
    expect((await routes.createKey(new Uint8Array(randomBytes(16)))).status).toBe(403);
    const nonce = await approveKey(owner);
    expect((await routes.createKey(nonce)).status).toBe(200);
    expect((await routes.createKey(nonce)).status).toBe(403);
  });

  it('refuses an admin by grant and anyone else', async () => {
    const byGrant = await setup({ signedIn: granted }).createKey(await approveKey(granted));
    expect(byGrant.status).toBe(403);
    expect(await byGrant.json()).toEqual({ error: { code: 'owner_list_only' } });
    const byMember = await setup({ signedIn: member }).createKey(await approveKey(member));
    expect(await byMember.json()).toEqual({ error: { code: 'not_admin' } });
    expect((await setup({ signedIn: member }).keyStatus()).status).toBe(403);
    const status = await (await setup({ signedIn: granted }).keyStatus()).json();
    expect(status).toEqual({ canManage: false, key: null });
  });

  it('refuses an app_auth insert without a spent corrector_key step-up', async () => {
    await expect(
      testDatabase.asAdmin(async (client) => {
        await client.query('BEGIN');
        try {
          await client.query('SET LOCAL ROLE app_auth');
          await client.query(`SELECT set_config('app.account_id', $1, true)`, [
            owner.signedIn.accountId,
          ]);
          await client.query(
            `INSERT INTO knowledge.corrector_key (kind, key_sha256, actor_account_id, step_up_id)
             VALUES ('created', $1, $2, gen_random_uuid())`,
            [randomBytes(32), owner.signedIn.accountId],
          );
        } finally {
          await client.query('ROLLBACK');
        }
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('works on the corrector routes until a new key replaces it', async () => {
    const first = await newKey();
    expect((await setup().listRequests(first)).status).toBe(200);
    const second = await newKey();
    expect((await setup().listRequests(first)).status).toBe(401);
    expect((await setup().listRequests(second)).status).toBe(200);
  });

  it('stops working once revoked, and a revocation names the live key', async () => {
    const key = await newKey();
    const { key: live } = (await (await setup().keyStatus()).json()) as { key: { id: string } };
    expect((await setup({ signedIn: granted }).revokeKey(live.id)).status).toBe(403);
    expect((await setup().revokeKey(randomUUID())).status).toBe(404);
    expect((await setup().revokeKey(live.id)).status).toBe(200);
    expect((await setup().revokeKey(live.id)).status).toBe(404);
    expect((await setup().listRequests(key)).status).toBe(401);
    expect(await (await setup().keyStatus()).json()).toEqual({ canManage: true, key: null });
    expect(await auditCodes('corrector_key_revoked')).toHaveLength(1);
    expect(notices).toEqual([
      `${owner.signedIn.accountId}:corrector_key_changed`,
      `${owner.signedIn.accountId}:corrector_key_changed`,
    ]);
  });

  it('stops working a year after it was made', async () => {
    const key = await newKey();
    await testDatabase.asAdmin((client) =>
      client.query(`UPDATE knowledge.corrector_key SET at = now() - interval '1 year 1 day'`),
    );
    expect((await setup().listRequests(key)).status).toBe(401);
  });

  it('stops working when its creator leaves the owner list or the account is gone', async () => {
    const key = await newKey();
    expect((await setup({ ownerList: [member.signedIn.accountId] }).listRequests(key)).status).toBe(
      401,
    );
    await testDatabase.asAdmin((client) =>
      client.query('UPDATE auth.user SET confirmed_at = NULL WHERE id = $1', [
        owner.signedIn.accountId,
      ]),
    );
    try {
      expect((await setup().listRequests(key)).status).toBe(401);
    } finally {
      await testDatabase.asAdmin((client) =>
        client.query('UPDATE auth.user SET confirmed_at = now() WHERE id = $1', [
          owner.signedIn.accountId,
        ]),
      );
    }
  });
});

describe('the corrector routes (ADR-0029)', () => {
  it.each([
    ['no header', undefined],
    ['a wrong key', `arca_ck_${randomBytes(32).toString('base64url')}`],
    ['a value shaped like no key', 'not-a-key'],
  ])('answer 401 to %s and audit it with identifiers only', async (_label, presented) => {
    await newKey();
    const response = await setup().listRequests(presented);
    expect(response.status).toBe(401);
    expect(await auditCodes('corrector_key_refused')).toEqual([
      { subject: owner.signedIn.accountId, actor: null, details: {} },
    ]);
  });

  it('count every request per address before reading the key, and audit a refusal only within its own limit', async () => {
    const hits: string[] = [];
    const limiter: RateLimiter = {
      hit: (rule) => {
        hits.push(rule.name);
        return Promise.resolve(
          rule.name === 'corrector_refused_log_ip'
            ? { allowed: false, retryAfterSeconds: 60 }
            : { allowed: true },
        );
      },
      sweep: () => Promise.resolve(0),
    };
    expect((await setup({ limiter }).listRequests('arca_ck_wrong')).status).toBe(401);
    expect(hits).toEqual(['corrector_ip', 'corrector_refused_log_ip']);
    expect(await auditCodes('corrector_key_refused')).toEqual([]);
    const closed: RateLimiter = {
      hit: () => Promise.resolve({ allowed: false, retryAfterSeconds: 60 }),
      sweep: () => Promise.resolve(0),
    };
    expect((await setup({ limiter: closed }).listRequests('arca_ck_wrong')).status).toBe(429);
  });

  it('refuse a browser request from another site before counting anything', async () => {
    const hits: string[] = [];
    const limiter: RateLimiter = {
      hit: (rule) => {
        hits.push(rule.name);
        return Promise.resolve({ allowed: true });
      },
      sweep: () => Promise.resolve(0),
    };
    const key = await newKey();
    expect((await setup({ limiter }).listRequests(key, 'cross-site')).status).toBe(403);
    expect(hits).toEqual([]);
    expect((await setup({ limiter }).listRequests(key, 'same-origin')).status).toBe(200);
  });

  it('count a key per route', async () => {
    const key = await newKey();
    const limiter: RateLimiter = {
      hit: (rule) =>
        Promise.resolve(
          rule.name === 'corrector_answer_key'
            ? { allowed: false, retryAfterSeconds: 60 }
            : { allowed: true },
        ),
      sweep: () => Promise.resolve(0),
    };
    expect((await setup({ limiter }).listRequests(key)).status).toBe(200);
    const answer = await setup({ limiter }).answer(key, randomUUID(), { kind: 'taken' });
    expect(answer.status).toBe(429);
  });

  it('serve the flagged versions to the live key only, counted with the listing', async () => {
    const key = await newKey();
    const hits: string[] = [];
    const limiter: RateLimiter = {
      hit: (rule) => (hits.push(rule.name), Promise.resolve({ allowed: true })),
      sweep: () => Promise.resolve(0),
    };
    expect((await setup({ limiter }).listFlagged()).status).toBe(401);
    const response = await setup({ limiter }).listFlagged(key);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ versions: [] });
    expect(hits).toContain('corrector_list_key');
  });

  it('list open and taken requests, oldest first, at most ten, with their sources', async () => {
    const key = await newKey();
    const ids: string[] = [];
    for (let minutes = 12; minutes > 0; minutes--) ids.push(await filed(minutes));
    const response = await setup().listRequests(key);
    const { requests } = (await response.json()) as {
      requests: { id: string; sources: unknown[]; state: string; routeId: string }[];
    };
    expect(requests.map(({ id }) => id)).toEqual(ids.slice(0, 10));
    expect(requests[0]).toMatchObject({
      routeId: 'qm-sample',
      versionNumber: 1,
      item: { kind: 'requirement', key: 'income' },
      note: 'O valor mudou.',
      state: 'open',
      sources: [
        { kind: 'link', url: 'https://example.gov/lei' },
        { kind: 'file', mediaType: 'application/pdf', size: 19, pageUrl: null },
      ],
    });
    expect(await auditCodes('corrector_requests_listed')).toEqual([
      {
        subject: owner.signedIn.accountId,
        actor: null,
        details: { keyId: expect.any(String) as unknown, count: 10 },
      },
    ]);
  });

  it('leave out answered and closed requests, and those a correction closed', async () => {
    const key = await newKey();
    const open = await filed(4);
    const answered = await filed(3);
    const closed = await filed(2);
    await filed(1, 3);
    const routes = setup();
    await routes.answer(key, answered, { kind: 'taken' });
    await routes.answer(key, answered, { kind: 'no_change', explanation: 'Nada mudou.' });
    await testDatabase.asAdmin((client) =>
      client.query(
        `INSERT INTO knowledge.correction_event (request_id, kind) VALUES ($1, 'closed')`,
        [closed],
      ),
    );
    states = decided({ 4: 'active' });
    expect((await listedIds(key)).map(({ id }) => id)).toEqual([open]);
  });

  it('mint a 5-minute URL for a file of a listed request, audited, and nothing else', async () => {
    const key = await newKey();
    const id = await filed();
    const routes = setup();
    expect((await routes.fileUrl(key, id, 0)).status).toBe(404);
    const minted = await routes.fileUrl(key, id, 1);
    expect(minted.status).toBe(200);
    expect(((await minted.json()) as { url: string }).url).toEqual(expect.any(String));
    expect(await auditCodes('corrector_file_downloaded')).toEqual([
      {
        subject: owner.signedIn.accountId,
        actor: null,
        details: { keyId: expect.any(String) as unknown, requestId: id, position: 1 },
      },
    ]);
    await routes.answer(key, id, { kind: 'taken' });
    await routes.answer(key, id, { kind: 'version_proposed', number: 2 });
    expect((await routes.fileUrl(key, id, 1)).status).toBe(404);
  });

  it('take an open request, then answer it with a proposed version the admins see', async () => {
    const key = await newKey();
    const id = await filed();
    const routes = setup();
    expect((await routes.answer(key, id, { kind: 'version_proposed', number: 2 })).status).toBe(
      409,
    );
    expect((await routes.answer(key, id, { kind: 'taken' })).status).toBe(200);
    expect(await routes.answer(key, id, { kind: 'taken' })).toHaveProperty('status', 409);
    expect((await listedIds(key))[0]?.state).toBe('taken');
    expect((await routes.answer(key, id, { kind: 'version_proposed', number: 2 })).status).toBe(
      200,
    );
    expect(await listedIds(key)).toEqual([]);
    const admin = (await (await routes.listAdmin()).json()) as {
      requests: { state: string; answer: unknown }[];
    };
    expect(admin.requests[0]).toMatchObject({
      state: 'answered',
      answer: { kind: 'version_proposed', number: 2 },
    });
    expect(
      (await auditCodes('correction_answered')).map(
        ({ details }) => (details as { answer: string }).answer,
      ),
    ).toEqual(['taken', 'version_proposed']);
    expect((await routes.answer(key, id, { kind: 'no_change', explanation: 'x' })).status).toBe(
      404,
    );
  });

  it('close a request once the version its answer proposed is decided', async () => {
    const key = await newKey();
    const id = await filed(0, 3);
    const routes = setup();
    await routes.answer(key, id, { kind: 'taken' });
    expect((await routes.answer(key, id, { kind: 'version_proposed', number: 4 })).status).toBe(
      200,
    );
    states = decided({ 4: 'rejected' });
    const admin = (await (await routes.listAdmin(3)).json()) as { requests: { state: string }[] };
    expect(admin.requests[0]?.state).toBe('closed');
  });

  it('list a request for a new route with its country, and take a version on a route of that country', async () => {
    const key = await newKey();
    const id = await filedNewRoute();
    const routes = setup();
    const { requests } = (await (await routes.listRequests(key)).json()) as {
      requests: unknown[];
    };
    expect(requests).toEqual([
      {
        id,
        routeId: null,
        versionNumber: null,
        item: null,
        countryCode: 'qm',
        note: 'Visto de trabalho temporário.',
        createdAt: expect.any(String) as unknown,
        sources: [
          { kind: 'text', text: 'A taxa é de 120 euros.', url: 'https://example.gov/fees' },
        ],
        state: 'open',
      },
    ]);
    expect((await routes.answer(key, id, { kind: 'taken' })).status).toBe(200);
    for (const refused of [
      { kind: 'version_proposed', number: 1 },
      { kind: 'version_proposed', number: 1, routeId: 'xx-new' },
      { kind: 'version_proposed', number: 2, routeId: 'qm-new' },
      { kind: 'version_proposed', number: 1, routeId: 'qm-missing' },
    ]) {
      const response = await routes.answer(key, id, refused);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_version' } });
    }
    expect(
      (await routes.answer(key, id, { kind: 'version_proposed', number: 1, routeId: 'qm-new' }))
        .status,
    ).toBe(200);
    const listedRoutes = async () =>
      ((await (await routes.listRouteRequests()).json()) as { requests: unknown[] }).requests;
    expect(await listedRoutes()).toMatchObject([
      { id, state: 'answered', answer: { kind: 'version_proposed', routeId: 'qm-new', number: 1 } },
    ]);
    states = new Map([[identityKey(newRoute), 'active']]);
    expect(await listedRoutes()).toMatchObject([{ id, state: 'closed' }]);
  });

  it('refuse a route on an answer to a request on a version, unless it is the request’s own', async () => {
    const key = await newKey();
    const id = await filed();
    const routes = setup();
    await routes.answer(key, id, { kind: 'taken' });
    const other = { kind: 'version_proposed', number: 1, routeId: 'qm-new' };
    expect((await routes.answer(key, id, other)).status).toBe(409);
    const own = { kind: 'version_proposed', number: 2, routeId: 'qm-sample' };
    expect((await routes.answer(key, id, own)).status).toBe(200);
  });

  it('answer a request for a new route that nothing changed', async () => {
    const key = await newKey();
    const id = await filedNewRoute();
    const routes = setup();
    await routes.answer(key, id, { kind: 'taken' });
    const answer = { kind: 'no_change', explanation: 'O site oficial não traz a taxa.' };
    expect((await routes.answer(key, id, answer)).status).toBe(200);
    expect(
      ((await (await routes.listRouteRequests()).json()) as { requests: unknown[] }).requests,
    ).toMatchObject([{ id, state: 'answered', answer }]);
  });

  it('show an answer that nothing changed as its explanation', async () => {
    const key = await newKey();
    await filed();
    const [request] = await listedIds(key);
    const routes = setup();
    await routes.answer(key, request?.id ?? '', { kind: 'taken' });
    const explanation = 'Não achei fonte oficial: https://example.gov/lei não traz o valor.';
    expect(
      (await routes.answer(key, request?.id ?? '', { kind: 'no_change', explanation })).status,
    ).toBe(200);
    const admin = (await (await routes.listAdmin()).json()) as { requests: { answer: unknown }[] };
    expect(admin.requests[0]?.answer).toEqual({ kind: 'no_change', explanation });
  });

  it.each([
    ['a version the route does not serve', 9],
    ['the request version itself', 1],
    ['an older version', 1, 3],
    ['a version on another line that does not follow', 2, 3],
  ])('refuse %s with 409 invalid_version', async (_label, number, version = 1) => {
    const key = await newKey();
    const id = await filed(0, version);
    const routes = setup();
    await routes.answer(key, id, { kind: 'taken' });
    const response = await routes.answer(key, id, { kind: 'version_proposed', number });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: 'invalid_version' } });
  });

  it.each([
    ['active', 'active'],
    ['rejected', 'rejected'],
  ] as const)(
    'refuse a later version already %s, since a key never closes a request',
    async (_label, state) => {
      const key = await newKey();
      const id = await filed();
      const routes = setup();
      await routes.answer(key, id, { kind: 'taken' });
      states = decided({ 3: state });
      const response = await routes.answer(key, id, { kind: 'version_proposed', number: 3 });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code: 'invalid_version' } });
      expect((await listedIds(key))[0]?.state).toBe('taken');
    },
  );

  it('refuse a malformed answer, an explanation over 2,000 characters included', async () => {
    const key = await newKey();
    const id = await filed();
    const routes = setup();
    await routes.answer(key, id, { kind: 'taken' });
    for (const answer of [
      { kind: 'closed' },
      { kind: 'version_proposed', number: 0 },
      { kind: 'no_change', explanation: 'x'.repeat(2001) },
    ]) {
      expect((await routes.answer(key, id, answer)).status).toBe(400);
    }
  });

  it('answer 404 for a request that does not exist', async () => {
    const key = await newKey();
    expect((await setup().answer(key, randomUUID(), { kind: 'taken' })).status).toBe(404);
  });

  it('let the definer functions refuse a digest that is not the live key', async () => {
    await newKey();
    const id = await filed();
    const live = await testDatabase.asAdmin(
      async (client) =>
        (await client.query<{ id: string }>('SELECT id FROM knowledge.corrector_key')).rows[0]?.id,
    );
    for (const call of [
      'SELECT * FROM knowledge.corrector_request_list($1, $2)',
      `SELECT knowledge.corrector_file($1, $2, '${id}', 1)`,
      `SELECT knowledge.answer_correction_request($1, $2, '${id}', 'taken', NULL, NULL)`,
      'SELECT * FROM knowledge.corrector_request_queue($1, $2)',
      `SELECT knowledge.answer_new_route_request($1, $2, '${id}', 'qm-new', 1)`,
    ]) {
      await expect(
        testDatabase.asAdmin(async (client) => {
          await client.query('BEGIN');
          try {
            await client.query('SET LOCAL ROLE app_api');
            await client.query(call, [live, randomBytes(32)]);
          } finally {
            await client.query('ROLLBACK');
          }
        }),
      ).rejects.toThrow(/live corrector key/);
    }
  });

  it('let the database refuse a new route in another country or past version 1', async () => {
    const key = await newKey();
    const id = await filedNewRoute();
    await setup().answer(key, id, { kind: 'taken' });
    const keyId = await testDatabase.asAdmin(
      async (client) =>
        (await client.query<{ id: string }>('SELECT id FROM knowledge.corrector_key')).rows[0]?.id,
    );
    const digest = createHash('sha256').update(key, 'utf8').digest();
    for (const [route, version, expected] of [
      ['xx-new', 1, 'refused'],
      ['qm-new', 2, 'refused'],
      ['qm-new', 1, 'stored'],
    ] as const) {
      const outcome = await testDatabase.asAdmin(async (client) => {
        await client.query('BEGIN');
        try {
          await client.query('SET LOCAL ROLE app_api');
          return (
            await client.query<{ outcome: string }>(
              'SELECT knowledge.answer_new_route_request($1, $2, $3, $4, $5) AS outcome',
              [keyId, digest, id, route, version],
            )
          ).rows[0]?.outcome;
        } finally {
          await client.query('ROLLBACK');
        }
      });
      expect(outcome).toBe(expected);
    }
  });

  it('refuse callers the definer functions do not serve', async () => {
    await newKey();
    const keyId = await testDatabase.asAdmin(
      async (client) =>
        (await client.query<{ id: string }>('SELECT id FROM knowledge.corrector_key')).rows[0]?.id,
    );
    const grantId = await testDatabase.asAdmin(
      async (client) =>
        (await client.query<{ id: string }>('SELECT id FROM knowledge.admin_grant')).rows[0]?.id,
    );
    const refused = { cause: { code: '42501' } };
    await expect(
      withIdentity(testDatabase.apiDb, { accountId: granted.signedIn.accountId }, (tx) =>
        tx.execute(sql`SELECT knowledge.revoke_corrector_key(${keyId}::uuid, 'grant')`),
      ),
    ).rejects.toMatchObject(refused);
    await expect(
      testDatabase.apiDb.transaction((tx) =>
        tx.execute(sql`SELECT knowledge.revoke_corrector_key(${keyId}::uuid, 'owner_list')`),
      ),
    ).rejects.toMatchObject(refused);
    await expect(
      withIdentity(testDatabase.apiDb, { accountId: member.signedIn.accountId }, (tx) =>
        tx.execute(
          sql`SELECT * FROM knowledge.correction_events('qm-sample', 1, 'grant', ${grantId}::uuid)`,
        ),
      ),
    ).rejects.toMatchObject(refused);
    const exported = (accountId: string, entry: string) =>
      withIdentity(
        testDatabase.apiDb,
        { accountId },
        async (tx) =>
          (
            await tx.execute<Record<string, unknown>>(
              sql`SELECT * FROM knowledge.own_corrector_key_rows(${entry})`,
            )
          ).rows,
      );
    expect(await exported(owner.signedIn.accountId, 'knowledge.corrector_key')).toHaveLength(1);
    expect(await exported(member.signedIn.accountId, 'knowledge.corrector_key')).toEqual([]);
    expect(await exported(owner.signedIn.accountId, 'knowledge.correction_request')).toEqual([]);
  });
});
