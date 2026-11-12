import { createHash, randomUUID } from 'node:crypto';
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
import { createCorrectionContents } from '../../src/knowledge/correction-contents.js';
import { createCorrections } from '../../src/knowledge/corrections.js';
import { memoryObjectStorage, type MemoryObjectStorage } from '../../src/storage/object-storage.js';
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
let objects: MemoryObjectStorage = memoryObjectStorage();
let presigns: unknown[] = [];

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
    storage: {
      ...objects,
      presignUpload: (pathname, maxBytes, contentType) => {
        presigns.push({ pathname, maxBytes, contentType });
        return Promise.resolve({
          type: 'blob.generate-presigned-url',
          presignedUrlPayload: { delegationToken: 'd', signature: 's', params: {} },
        });
      },
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
    memoryObjects: objects,
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
    startUpload: (body: Record<string, unknown>) => post('/uploads', body),
    presign: (pathname: string) =>
      post('/uploads/url', {
        type: 'blob.generate-presigned-url',
        payload: { pathname, clientPayload: null, multipart: false },
      }),
    put: (url: string, bytes: Uint8Array) =>
      app.request(url, { method: 'PUT', body: new Uint8Array(bytes) }),
    get: (url: string) => app.request(url),
    fileUrl: (requestId: string, position: number) => post('/files/url', { requestId, position }),
  };
}

const pdf = new TextEncoder().encode('%PDF-1.7\nSynthetic official gazette page\n%%EOF\n');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('base64url');

/** Starts an upload as the owner and sends `sent`, declared as `declared`; answers its ID. */
async function uploaded(
  sent: Uint8Array,
  declared: { mediaType?: string; bytes?: Uint8Array } = {},
) {
  const routes = setup(owner);
  const bytes = declared.bytes ?? sent;
  const started = await routes.startUpload({
    mediaType: declared.mediaType ?? 'application/pdf',
    size: bytes.length,
    sha256: sha256(bytes),
  });
  expect(started.status).toBe(200);
  const { uploadId, upload } = (await started.json()) as {
    uploadId: string;
    upload: { via: 'direct'; url: string };
  };
  expect((await routes.put(upload.url, sent)).status).toBe(204);
  return uploadId;
}

const withFile = (uploadId: string) => ({
  sources: [...filed.sources, { kind: 'file', uploadId }],
});

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
    requests: {
      id: string;
      state: string;
      note: string | null;
      sources: unknown[];
      item: unknown;
    }[];
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
  objects = memoryObjectStorage();
  presigns = [];
  await testDatabase.asAdmin(async (client) => {
    await client.query(
      'TRUNCATE knowledge.correction_request, knowledge.correction_upload, knowledge.admin_grant CASCADE',
    );
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
    expect((await listed(owner)).requests).toEqual([]);
    expect(notices).toEqual([]);
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

  it('answers 429 on presign and download once their daily limits are spent', async () => {
    const spent: RateLimiter = {
      hit: () => Promise.resolve({ allowed: false, retryAfterSeconds: 60 }),
      sweep: () => Promise.resolve(0),
    };
    expect((await setup(owner, spent).presign(`corrections/${randomUUID()}`)).status).toBe(429);
    expect((await setup(owner, spent).fileUrl(randomUUID(), 0)).status).toBe(429);
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

describe('files on a correction request (ADR-0029)', () => {
  it('files an uploaded PDF and lets any admin download it, never anyone else', async () => {
    const uploadId = await uploaded(pdf);
    const response = await setup(owner).file(withFile(uploadId));
    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: string };
    const [request] = (await listed(granted)).requests;
    expect(request?.sources).toEqual([
      ...filed.sources,
      { kind: 'file', mediaType: 'application/pdf', size: pdf.length },
    ]);
    for (const admin of [owner, granted]) {
      const link = await setup(admin).fileUrl(id, 2);
      expect(link.status).toBe(200);
      const { url } = (await link.json()) as { url: string };
      const download = await setup(admin).get(url);
      expect(download.headers.get('content-disposition')).toBe('attachment');
      expect(download.headers.get('x-content-type-options')).toBe('nosniff');
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(pdf);
    }
    expect((await setup(member).fileUrl(id, 2)).status).toBe(403);
    expect((await setup(owner).fileUrl(id, 0)).status).toBe(404);
    expect(await audited('correction_file_downloaded')).toEqual([
      { details: { requestId: id, position: 2 } },
      { details: { requestId: id, position: 2 } },
    ]);
  });

  it.each<[string, Record<string, unknown>]>([
    ['an image', { mediaType: 'image/png', size: 10, sha256: sha256(pdf) }],
    [
      'a file over 16 MB',
      { mediaType: 'application/pdf', size: 16 * 1024 * 1024 + 1, sha256: sha256(pdf) },
    ],
  ])('refuses to start an upload of %s with 400', async (_label, body) => {
    expect((await setup(owner).startUpload(body)).status).toBe(400);
  });

  it('answers 403 to anyone but an owner-list admin starting an upload', async () => {
    const body = { mediaType: 'application/pdf', size: pdf.length, sha256: sha256(pdf) };
    const byGrant = await setup(granted).startUpload(body);
    expect(byGrant.status).toBe(403);
    expect(await byGrant.json()).toEqual({ error: { code: 'owner_list_only' } });
    expect((await setup(member).startUpload(body)).status).toBe(403);
  });

  it('refuses a file whose content is not its declared type, and deletes it', async () => {
    const text = new TextEncoder().encode('Plain synthetic text, declared a PDF');
    const uploadId = await uploaded(text);
    const response = await setup(owner).file(withFile(uploadId));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: 'upload_mismatch' } });
    expect(await audited('correction_upload_mismatch')).toEqual([{ details: { uploadId } }]);
    expect(await objectsHeld()).toBe(0);
    expect((await listed(owner)).requests).toEqual([]);
  });

  it('refuses a file whose digest is not the declared one, and deletes it', async () => {
    const declared = pdf.map((byte, index) => (index === pdf.length - 2 ? byte ^ 1 : byte));
    const uploadId = await uploaded(pdf, { bytes: declared });
    const response = await setup(owner).file(withFile(uploadId));
    expect(response.status).toBe(409);
    expect(await objectsHeld()).toBe(0);
  });

  it('answers 409 not_uploaded before the file arrived and 404 for an unknown upload', async () => {
    const routes = setup(owner);
    const started = await routes.startUpload({
      mediaType: 'text/plain',
      size: 3,
      sha256: sha256(new Uint8Array([1, 2, 3])),
    });
    const { uploadId } = (await started.json()) as { uploadId: string };
    expect((await routes.file(withFile(uploadId))).status).toBe(409);
    expect((await routes.file(withFile(randomUUID()))).status).toBe(404);
  });

  it('presigns only the owner’s own unused upload started within the hour, at its size and type', async () => {
    const routes = setup(owner);
    const started = await routes.startUpload({
      mediaType: 'text/html',
      size: 40,
      sha256: sha256(pdf),
    });
    const { upload } = (await started.json()) as { upload: { url: string } };
    const pathname = new URL(upload.url, origin).pathname.replace('/internal/objects/', '');
    expect((await routes.presign(pathname)).status).toBe(200);
    expect(presigns).toEqual([{ pathname, maxBytes: 40, contentType: 'text/html' }]);
    expect((await setup(granted).presign(pathname)).status).toBe(403);
    expect((await setup(member).presign(pathname)).status).toBe(403);
    expect((await routes.presign(`corrections/${randomUUID()}`)).status).toBe(404);
    await testDatabase.asAdmin((client) =>
      client.query(
        `UPDATE knowledge.correction_upload SET created_at = now() - interval '61 minutes'`,
      ),
    );
    expect((await routes.presign(pathname)).status).toBe(404);
  });

  it('does not presign an upload a request already names', async () => {
    const uploadId = await uploaded(pdf);
    expect((await setup(owner).file(withFile(uploadId))).status).toBe(200);
    const pathname = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ pathname: string }>(
            'SELECT pathname FROM knowledge.correction_upload',
          )
        ).rows[0]?.pathname ?? '',
    );
    expect((await setup(owner).presign(pathname)).status).toBe(404);
  });

  it('refuses a file named twice in one request with 400', async () => {
    const uploadId = await uploaded(pdf);
    const twice = {
      sources: [
        { kind: 'file', uploadId },
        { kind: 'file', uploadId },
      ],
    };
    expect((await setup(owner).file(twice)).status).toBe(400);
  });

  it('refuses a file filed more than 2 hours after its upload started', async () => {
    const uploadId = await uploaded(pdf);
    await testDatabase.asAdmin((client) =>
      client.query(
        `UPDATE knowledge.correction_upload SET created_at = now() - interval '121 minutes'`,
      ),
    );
    expect((await setup(owner).file(withFile(uploadId))).status).toBe(404);
  });

  it('takes an upload in one request only', async () => {
    const uploadId = await uploaded(pdf);
    expect((await setup(owner).file(withFile(uploadId))).status).toBe(200);
    expect((await setup(owner).file(withFile(uploadId))).status).toBe(404);
  });
});

const audited = (code: string) =>
  testDatabase.asAdmin(
    async (client) =>
      (
        await client.query<{ details: unknown }>(
          'SELECT details FROM audit.event WHERE code = $1 ORDER BY time, id',
          [code],
        )
      ).rows,
  );

/** How many objects the memory store holds under `corrections/`. */
async function objectsHeld(): Promise<number> {
  const pathnames = await testDatabase.asAdmin(
    async (client) =>
      (await client.query<{ pathname: string }>('SELECT pathname FROM knowledge.correction_upload'))
        .rows,
  );
  let held = 0;
  for (const { pathname } of pathnames) {
    if ((await objects.digest(pathname)) !== undefined) held += 1;
  }
  return held;
}

describe('the retention of request contents (ADR-0029)', () => {
  const days = (count: number) => new Date(Date.now() + count * 86_400_000);
  const contents = () => createCorrectionContents({ db: testDatabase.jobsDb, storage: objects });

  it('erases an admin-closed request’s note, sources and files 30 days after the close', async () => {
    const response = await setup(owner).file(withFile(await uploaded(pdf)));
    const { id } = (await response.json()) as { id: string };
    await setup(owner).close(id);
    expect(await contents().expire(owner, days(29))).toBe(0);
    expect((await listed(owner)).requests[0]?.note).toBe(filed.note);
    expect(await contents().expire(owner, days(31))).toBe(1);
    const [request] = (await listed(owner)).requests;
    expect(request).toMatchObject({ id, note: null, sources: [], state: 'closed' });
    expect(await objectsHeld()).toBe(0);
    const left = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM knowledge.correction_upload',
          )
        ).rows[0]?.n,
    );
    expect(left).toBe(0);
  });

  it('keeps an open request’s contents until 180 days after filing', async () => {
    await setup(owner).file(withFile(await uploaded(pdf)));
    expect(await contents().expire(owner, days(179))).toBe(0);
    expect((await listed(owner)).requests[0]?.sources).toHaveLength(3);
    expect(await contents().expire(owner, days(181))).toBe(1);
    expect((await listed(owner)).requests[0]).toMatchObject({ note: null, sources: [] });
  });

  it('keeps a request a correction closed until 180 days after filing, since it can open again', async () => {
    await setup(owner).file(withFile(await uploaded(pdf)));
    const [, correction] = identities;
    if (correction === undefined) throw new Error('no correction');
    states = new Map([[identityKey(correction), 'active']]);
    expect((await listed(owner)).requests[0]?.state).toBe('closed');
    expect(await contents().expire(owner, days(31))).toBe(0);
    expect((await listed(owner)).requests[0]?.note).toBe(filed.note);
    expect(await contents().expire(owner, days(181))).toBe(1);
  });

  it('deletes an upload no request names a day after it started, with its file', async () => {
    await uploaded(pdf);
    expect(await contents().expire(owner, new Date(Date.now() + 23 * 3_600_000))).toBe(0);
    expect(await contents().expire(owner, days(1.1))).toBe(1);
    expect(await objectsHeld()).toBe(0);
  });

  it('touches only the author’s own rows', async () => {
    await setup(owner).file(withFile(await uploaded(pdf)));
    expect(await contents().expire(member, days(181))).toBe(0);
    expect((await listed(owner)).requests[0]?.note).toBe(filed.note);
  });

  it('erases every file of the author before the rows go', async () => {
    await setup(owner).file(withFile(await uploaded(pdf)));
    await contents().eraseObjects(owner);
    expect(await objectsHeld()).toBe(0);
  });
});

describe('the request tables (ADR-0029)', () => {
  it('give app_api no table to read, and only the author’s own rows through the export function', async () => {
    await fileOne();
    for (const table of [
      'correction_request',
      'correction_source',
      'correction_event',
      'correction_upload',
    ]) {
      await expect(
        withIdentity(testDatabase.apiDb, { accountId: owner }, (tx) =>
          tx.execute(sql`SELECT FROM ${sql.raw(`knowledge.${table}`)}`),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
      const exported = (accountId: string) =>
        withIdentity(
          testDatabase.apiDb,
          { accountId },
          async (tx) =>
            (
              await tx.execute<{ row: unknown }>(
                table === 'correction_upload'
                  ? sql`SELECT * FROM knowledge.own_correction_upload_rows(${`knowledge.${table}`})`
                  : sql`SELECT * FROM knowledge.own_correction_rows(${`knowledge.${table}`})`,
              )
            ).rows.length,
        );
      expect(await exported(granted)).toBe(0);
      if (table !== 'correction_event' && table !== 'correction_upload') {
        expect(await exported(owner)).toBeGreaterThan(0);
      }
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

  it('refuse a file on a request filed in an earlier transaction, or from another account’s upload', async () => {
    const id = await fileOne();
    const uploadId = await uploaded(pdf);
    const attach = (accountId: string) =>
      withIdentity(testDatabase.apiDb, { accountId }, (tx) =>
        tx.execute(
          sql`SELECT knowledge.attach_correction_file(${id}, 2, ${uploadId}, 'owner_list')`,
        ),
      );
    await expect(attach(owner)).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(attach(member)).rejects.toMatchObject({ cause: { code: '42501' } });
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
