import { randomUUID } from 'node:crypto';
import {
  identityKey,
  parseCalendarDate,
  type DecisionStates,
  type VersionIdentity,
  type VersionView,
} from '@arca/domain';
import { withIdentity } from '@arca/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { auditLog } from '../../src/audit/log.js';
import type { RateLimiter } from '../../src/auth/rate-limit.js';
import { adminRole } from '../../src/knowledge/admins.js';
import { createCorrections } from '../../src/knowledge/corrections.js';
import { noLimits } from '../limits.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';

// Correction requests on the real migrations (ADR-0029). Synthetic data only.
let testDatabase: AuthTestDatabase;
const owner = randomUUID();
const granted = randomUUID();
const member = randomUUID();
const origin = 'http://arca.test';

const identity = (number: number, corrects?: number): VersionIdentity => ({
  routeId: 'qm-sample',
  number,
  effectiveFrom: parseCalendarDate('2026-01-01'),
  ...(corrects === undefined ? {} : { corrects }),
  status: 'open',
  hash: String(number).repeat(64),
});
const identities = [identity(1), identity(2, 1)];
const view = {
  requirements: [{ id: 'income', title: 'Renda mínima' }],
  assessments: [],
  dependents: [],
  costs: [],
  durations: [],
  countrySets: [{ id: 'eu-free-movement', number: 2, title: 'UE' }],
} as unknown as VersionView;

let states: DecisionStates = new Map();
let notices: string[] = [];

function setup(signedIn: string | null, limiter = noLimits.limiter) {
  const corrections = createCorrections({
    db: () => testDatabase.apiDb,
    role: adminRole(() => testDatabase.apiDb, [owner]),
    versions: {
      view: (routeId, number) =>
        Promise.resolve(routeId === 'qm-sample' && number <= 2 ? view : undefined),
      identities: (routeId) => (routeId === 'qm-sample' ? identities : []),
    },
    states: () => Promise.resolve(states),
    audit: auditLog(testDatabase.auditDb),
    notify: (accountId, kind) => {
      notices.push(`${accountId}:${kind}`);
      return Promise.resolve();
    },
  });
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () =>
        Promise.resolve(
          signedIn === null ? null : { accountId: signedIn, sessionId: randomUUID() },
        ),
      refresh: () => Promise.resolve({ session: null, setCookies: [] }),
    },
    authLimits: { ...noLimits, limiter },
    corrections,
  });
  const post = (path: string, body: unknown) =>
    app.request(`/v1/knowledge/corrections${path}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return {
    file: (body: Record<string, unknown> = {}) => post('', { ...filed, ...body }),
    list: (number = 1) =>
      app.request(`/v1/knowledge/corrections?routeId=qm-sample&number=${String(number)}`),
    close: (id: string) => post('/close', { id }),
  };
}

const filed = {
  routeId: 'qm-sample',
  versionNumber: 1,
  item: { kind: 'requirement', key: 'income' },
  note: 'O valor mudou em 2026.',
  sources: [
    { kind: 'link', url: 'https://example.gov/lei' },
    { kind: 'text', text: 'Art. 2.º O valor passa a ser 900.' },
  ],
};

const listed = async (signedIn: string, number = 1) => {
  const response = await setup(signedIn).list(number);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    canFile: boolean;
    requests: { id: string; state: string; note: string; sources: unknown[]; item: unknown }[];
  };
};

const fileOne = async () => {
  const response = await setup(owner).file();
  expect(response.status).toBe(200);
  return ((await response.json()) as { id: string }).id;
};

beforeAll(async () => {
  testDatabase = await authTestDatabase();
});

afterAll(async () => {
  await testDatabase.drop();
});

beforeEach(async () => {
  states = new Map();
  notices = [];
  await testDatabase.asAdmin(async (client) => {
    await client.query('TRUNCATE knowledge.correction_request, knowledge.admin_grant CASCADE');
    await client.query(
      `INSERT INTO knowledge.admin_grant (kind, grantee_account_id, actor_account_id, actor_basis, step_up_id)
       VALUES ('grant', $1, $2, 'owner_list', $3)`,
      [granted, owner, randomUUID()],
    );
  });
});

describe('filing a correction request (ADR-0029)', () => {
  it('stores an owner-list admin request with its sources in order, audits it and tells the owners', async () => {
    const id = await fileOne();
    const { canFile, requests } = await listed(owner);
    expect(canFile).toBe(true);
    expect(requests).toEqual([
      {
        id,
        item: { kind: 'requirement', key: 'income' },
        note: filed.note,
        createdAt: expect.any(String) as unknown,
        sources: filed.sources,
        state: 'open',
      },
    ]);
    expect(notices).toEqual([`${owner}:correction_requested`]);
    const events = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ details: unknown }>(
            `SELECT details FROM audit.event WHERE code = 'correction_requested' AND subject_account_id = $1`,
            [owner],
          )
        ).rows,
    );
    expect(events).toEqual([{ details: { requestId: id, routeId: 'qm-sample', number: 1 } }]);
  });

  it('accepts the whole version and its settings with no key', async () => {
    for (const kind of ['version', 'settings']) {
      expect((await setup(owner).file({ item: { kind, key: null }, sources: [] })).status).toBe(
        200,
      );
    }
    expect((await listed(owner)).requests).toHaveLength(2);
  });

  it.each<[string, Record<string, unknown>]>([
    ['an empty note', { note: '   ' }],
    ['a note over 4,000 characters', { note: 'a'.repeat(4001) }],
    ['six sources', { sources: Array.from({ length: 6 }, () => ({ kind: 'text', text: 'x' })) }],
    ['an http link', { sources: [{ kind: 'link', url: 'http://example.gov/lei' }] }],
    [
      'pasted text over 20,000 characters',
      { sources: [{ kind: 'text', text: 'a'.repeat(20_001) }] },
    ],
    ['a keyed kind with no key', { item: { kind: 'requirement', key: null } }],
    ['the version with a key', { item: { kind: 'version', key: 'income' } }],
  ])('refuses %s with 400', async (_label, body) => {
    expect((await setup(owner).file(body)).status).toBe(400);
  });

  it.each<[string, Record<string, unknown>]>([
    ['an item the version lacks', { item: { kind: 'requirement', key: 'savings' } }],
    ['a version the catalog lacks', { versionNumber: 9 }],
  ])('answers 404 for %s', async (_label, body) => {
    expect((await setup(owner).file(body)).status).toBe(404);
  });

  it('answers 403 owner_list_only to an admin by grant and 403 not_admin to anyone else, storing nothing', async () => {
    const byGrant = await setup(granted).file();
    expect(byGrant.status).toBe(403);
    expect(await byGrant.json()).toEqual({ error: { code: 'owner_list_only' } });
    const byMember = await setup(member).file();
    expect(byMember.status).toBe(403);
    expect(await byMember.json()).toEqual({ error: { code: 'not_admin' } });
    expect((await setup(null).file()).status).toBe(401);
    expect((await listed(owner)).requests).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('answers 409 already_corrected on a version whose correction is active', async () => {
    const [, correction] = identities;
    if (correction === undefined) throw new Error('no correction');
    states = new Map([[identityKey(correction), 'active']]);
    expect((await setup(owner).file()).status).toBe(409);
  });

  it('refuses a link the database would refuse, such as an upper-case scheme', async () => {
    for (const url of ['HTTPS://example.gov/a', 'https:example.gov']) {
      expect((await setup(owner).file({ sources: [{ kind: 'link', url }] })).status).toBe(400);
    }
  });

  it('answers 429 once the daily limit is spent', async () => {
    const spent: RateLimiter = {
      hit: () => Promise.resolve({ allowed: false, retryAfterSeconds: 60 }),
      sweep: () => Promise.resolve(0),
    };
    expect((await setup(owner, spent).file()).status).toBe(429);
  });
});

describe('reading and closing requests (ADR-0029)', () => {
  it('shows an admin by grant the requests, without filing', async () => {
    const id = await fileOne();
    const { canFile, requests } = await listed(granted);
    expect(canFile).toBe(false);
    expect(requests.map((request) => request.id)).toEqual([id]);
  });

  it('refuses anyone else and an unknown version', async () => {
    await fileOne();
    expect((await setup(member).list()).status).toBe(403);
    expect((await setup(owner).list(9)).status).toBe(404);
  });

  it('lists only the asked version', async () => {
    await fileOne();
    expect((await listed(owner, 2)).requests).toEqual([]);
  });

  it('lets any admin close a request, once', async () => {
    const id = await fileOne();
    expect((await setup(granted).close(id)).status).toBe(200);
    expect((await setup(owner).close(id)).status).toBe(200);
    expect((await listed(owner)).requests.map((request) => request.state)).toEqual(['closed']);
    const closes = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ actor: string }>(
            `SELECT actor_account_id AS actor FROM audit.event WHERE code = 'correction_closed'`,
          )
        ).rows,
    );
    expect(closes).toEqual([{ actor: granted }]);
    expect((await setup(member).close(id)).status).toBe(403);
    expect((await setup(owner).close(randomUUID())).status).toBe(404);
  });

  it('refuses an admin whose grant was taken away', async () => {
    await testDatabase.asAdmin((client) =>
      client.query(
        `INSERT INTO knowledge.admin_grant (kind, grantee_account_id, actor_account_id, actor_basis, removes_grant_id)
         SELECT 'removal', grantee_account_id, actor_account_id, 'owner_list', id FROM knowledge.admin_grant`,
      ),
    );
    expect((await setup(granted).list()).status).toBe(403);
  });

  it('closes a request once a correction of its version is active, and not before', async () => {
    await fileOne();
    const [, correction] = identities;
    if (correction === undefined) throw new Error('no correction');
    states = new Map([[identityKey(correction), 'rejected']]);
    expect((await listed(owner)).requests.map((request) => request.state)).toEqual(['open']);
    states = new Map([[identityKey(correction), 'active']]);
    expect((await listed(owner)).requests.map((request) => request.state)).toEqual(['closed']);
  });
});

describe('the request tables (ADR-0029)', () => {
  it('let app_api read only the author’s own rows, for the export', async () => {
    await fileOne();
    for (const table of ['correction_request', 'correction_source', 'correction_event']) {
      const read = (accountId: string) =>
        withIdentity(
          testDatabase.apiDb,
          { accountId },
          async (tx) =>
            (
              await tx.execute<Record<string, unknown>>(
                sql`SELECT * FROM ${sql.raw(`knowledge.${table}`)}`,
              )
            ).rows.length,
        );
      expect(await read(granted)).toBe(0);
      if (table !== 'correction_event') expect(await read(owner)).toBeGreaterThan(0);
    }
  });

  it('refuse a close on a grant that is not the account’s own', async () => {
    const id = await fileOne();
    const [grantId] = await testDatabase.asAdmin(async (client) =>
      (await client.query<{ id: string }>('SELECT id FROM knowledge.admin_grant')).rows.map(
        (row) => row.id,
      ),
    );
    await expect(
      withIdentity(testDatabase.apiDb, { accountId: member }, (tx) =>
        tx.execute(sql`SELECT knowledge.close_correction_request(${id}, 'grant', ${grantId})`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('refuse filing on a grant basis and reading on a grant that is not the account’s own', async () => {
    const [grantId] = await testDatabase.asAdmin(async (client) =>
      (await client.query<{ id: string }>('SELECT id FROM knowledge.admin_grant')).rows.map(
        (row) => row.id,
      ),
    );
    await expect(
      withIdentity(testDatabase.apiDb, { accountId: granted }, (tx) =>
        tx.execute(sql`SELECT knowledge.file_correction_request('qm-sample', 1, 'version', NULL,
          'nota', '[]'::jsonb, 'grant')`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(
      withIdentity(testDatabase.apiDb, { accountId: member }, (tx) =>
        tx.execute(
          sql`SELECT * FROM knowledge.correction_requests('qm-sample', 1, 'grant', ${grantId})`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('let app_jobs read and delete only the author’s own requests, with their sources', async () => {
    const id = await fileOne();
    const own = await withIdentity(testDatabase.jobsDb, { accountId: owner }, async (tx) => ({
      requests: (await tx.execute<{ id: string }>(sql`SELECT id FROM knowledge.correction_request`))
        .rows,
      sources: (
        await tx.execute<{ position: number }>(
          sql`SELECT position FROM knowledge.correction_source`,
        )
      ).rows,
    }));
    expect(own).toEqual({ requests: [{ id }], sources: [{ position: 0 }, { position: 1 }] });
    const others = await withIdentity(
      testDatabase.jobsDb,
      { accountId: member },
      async (tx) =>
        (
          await tx.execute<{ id: string }>(
            sql`DELETE FROM knowledge.correction_request RETURNING id`,
          )
        ).rows,
    );
    expect(others).toEqual([]);
  });
});
