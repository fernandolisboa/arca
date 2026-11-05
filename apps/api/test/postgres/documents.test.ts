import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  documentPageSize,
  documentQuota,
  maxDocumentBytes,
  type DocumentUploadUrlResponse,
} from '@arca/api-contract/routes';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/audit/log.js';
import { createDocuments, type Documents } from '../../src/vault/documents.js';
import {
  memoryObjectStorage,
  type MemoryObjectStorage,
  type ObjectStorage,
} from '../../src/vault/object-storage.js';
import { putObject } from '../objects.js';
import { accountFixtures } from './accounts.js';
import { authTestDatabase, type AuthTestDatabase } from './auth-database.js';

// Documents on the real migrations: requests on app_api, the jobs on app_jobs, each under the
// account's identity, with an in-memory object store (spec 0005, R4). Synthetic data only.
let testDatabase: AuthTestDatabase;
let fixtures: ReturnType<typeof accountFixtures>;
let objects: MemoryObjectStorage;
let presigned: { pathname: string; maxBytes: number }[];
let documents: Documents;
let jobs: Documents;

const fakePresigned: DocumentUploadUrlResponse = {
  type: 'blob.generate-presigned-url',
  presignedUrlPayload: { delegationToken: 'token', signature: 'signature', params: {} },
};

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  fixtures = accountFixtures(testDatabase, 'localhost');
});

beforeEach(() => {
  objects = memoryObjectStorage();
  presigned = [];
  const storage: ObjectStorage = {
    ...objects,
    presignUpload: (pathname, maxBytes) => {
      presigned.push({ pathname, maxBytes });
      return Promise.resolve(fakePresigned);
    },
  };
  const audit = auditLog(testDatabase.auditDb);
  documents = createDocuments({ db: testDatabase.apiDb, storage, audit });
  jobs = createDocuments({ db: testDatabase.jobsDb, storage, audit });
});

afterAll(async () => {
  await testDatabase.drop();
});

const admin = <T extends object>(statement: string, values: unknown[] = []) =>
  testDatabase.asAdmin(async (client) => (await client.query<T>(statement, values)).rows);

/** An account with a current vault recipient. */
async function owner(): Promise<string> {
  const { accountId } = await fixtures.account(1);
  await admin(`INSERT INTO vault.recipient (account_id, recipient) VALUES ($1, 'age1pq1qqqq')`, [
    accountId,
  ]);
  return accountId;
}

const link = (inviterId: string, inviteeId: string) =>
  admin(`INSERT INTO account.link (inviter_id, invitee_id) VALUES ($1, $2)`, [
    inviterId,
    inviteeId,
  ]);

const share = (documentId: string, ownerId: string, recipientId: string) =>
  admin(
    `INSERT INTO vault.document_recipient (document_id, document_owner_id, recipient_id)
     VALUES ($1, $2, $3)`,
    [documentId, ownerId, recipientId],
  );

const sha256Of = (body: Uint8Array) => createHash('sha256').update(body).digest('base64url');

async function created(accountId: string, body: Uint8Array, typeKey = 'passport') {
  const outcome = await documents.create(accountId, {
    typeKey,
    size: body.length,
    sha256: sha256Of(body),
  });
  if (typeof outcome === 'string') throw new Error(outcome);
  return outcome;
}

const objectKeyOf = async (documentId: string) =>
  (
    await admin<{ object_key: string }>(`SELECT object_key FROM vault.document WHERE id = $1`, [
      documentId,
    ])
  )[0]?.object_key ?? 'missing';

/** A confirmed document holding `body`, stored as the device stores it. */
async function confirmed(accountId: string, body = randomBytes(64)) {
  const { documentId } = await created(accountId, body);
  putObject(objects, await objectKeyOf(documentId), body);
  expect(await documents.confirm(accountId, documentId)).toBe('confirmed');
  return documentId;
}

const events = (accountId: string) =>
  admin<{ code: string; details: object }>(
    `SELECT code, details FROM audit.event WHERE subject_account_id = $1 ORDER BY time, code`,
    [accountId],
  );

describe('creating a document (spec 0005, R4)', () => {
  it('adds a pending document under a fresh pathname with a direct upload grant', async () => {
    const accountId = await owner();
    const body = randomBytes(100);
    const { documentId, upload } = await created(accountId, body);
    const [row] = await admin<{ owner_id: string; size: number; confirmed_at: Date | null }>(
      `SELECT owner_id, size, confirmed_at FROM vault.document WHERE id = $1`,
      [documentId],
    );
    expect(row).toEqual({ owner_id: accountId, size: 100, confirmed_at: null });
    expect(upload.via).toBe('direct');
    expect(await objectKeyOf(documentId)).toMatch(/^documents\/[0-9a-f-]{36}$/);
  });

  it('refuses an account without a vault', async () => {
    const { accountId } = await fixtures.account(1);
    expect(
      await documents.create(accountId, {
        typeKey: 'passport',
        size: 1,
        sha256: sha256Of(randomBytes(1)),
      }),
    ).toBe('no_vault');
  });

  it('refuses the document past the quota of documents, pending ones included', async () => {
    const accountId = await owner();
    await admin(
      `INSERT INTO vault.document (owner_id, type_key, size, sha256, object_key)
       SELECT $1, 'passport', 1, $2, 'documents/' || gen_random_uuid()
         FROM generate_series(1, $3)`,
      [accountId, randomBytes(32), documentQuota.documents],
    );
    expect(
      await documents.create(accountId, {
        typeKey: 'passport',
        size: 1,
        sha256: sha256Of(randomBytes(1)),
      }),
    ).toBe('over_quota');
  });

  it('refuses the document past the quota of bytes, and takes one that fits', async () => {
    const accountId = await owner();
    const full = Math.floor(documentQuota.bytes / maxDocumentBytes);
    await admin(
      `INSERT INTO vault.document (owner_id, type_key, size, sha256, object_key)
       SELECT $1, 'passport', $2, $3, 'documents/' || gen_random_uuid()
         FROM generate_series(1, $4)`,
      [accountId, maxDocumentBytes, randomBytes(32), full],
    );
    const left = documentQuota.bytes - full * maxDocumentBytes;
    const sha256 = sha256Of(randomBytes(1));
    expect(await documents.create(accountId, { typeKey: 'passport', size: left + 1, sha256 })).toBe(
      'over_quota',
    );
    expect(
      typeof (await documents.create(accountId, { typeKey: 'passport', size: left, sha256 })),
    ).toBe('object');
  });

  it("waits for the vault's lock, so a reset never runs beside a create", async () => {
    const accountId = await owner();
    await testDatabase.asAdmin(async (client) => {
      await client.query('BEGIN');
      await client.query(`SELECT id FROM vault.recipient WHERE account_id = $1 FOR UPDATE`, [
        accountId,
      ]);
      let settled = false;
      const creating = documents
        .create(accountId, { typeKey: 'passport', size: 1, sha256: sha256Of(randomBytes(1)) })
        .finally(() => {
          settled = true;
        });
      for (let waited = 0; ; waited += 1) {
        const [blocked] = (
          await client.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'`,
          )
        ).rows;
        if ((blocked?.n ?? 0) > 0) break;
        if (waited > 200) throw new Error('the create never waited for the lock');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(settled).toBe(false);
      await client.query('COMMIT');
      expect(typeof (await creating)).toBe('object');
    });
  });
});

describe('presigning an upload (spec 0005, R4)', () => {
  it("presigns only a pending pathname of the account, for the document's declared size", async () => {
    const accountId = await owner();
    const stranger = await owner();
    const { documentId } = await created(accountId, randomBytes(300));
    const pathname = await objectKeyOf(documentId);
    expect(await documents.presignUpload(stranger, pathname)).toBeUndefined();
    expect(await documents.presignUpload(accountId, `documents/${randomUUID()}`)).toBeUndefined();
    expect(await documents.presignUpload(accountId, pathname)).toEqual(fakePresigned);
    expect(presigned).toEqual([{ pathname, maxBytes: 300 }]);
  });

  it('presigns nothing for a confirmed document', async () => {
    const accountId = await owner();
    const documentId = await confirmed(accountId);
    expect(await documents.presignUpload(accountId, await objectKeyOf(documentId))).toBeUndefined();
  });
});

describe('confirming an upload (spec 0005, R4)', () => {
  it('confirms the declared ciphertext once and records it', async () => {
    const accountId = await owner();
    const documentId = await confirmed(accountId);
    expect(await documents.confirm(accountId, documentId)).toBe('not_found');
    expect(await events(accountId)).toEqual([
      { code: 'document_created', details: { documentId } },
    ]);
  });

  it.each([
    ['other bytes of the same size', (body: Buffer) => Buffer.from(body).reverse()],
    ['a shorter object', (body: Buffer) => body.subarray(1)],
    ['no object', () => undefined],
  ])('discards the document and its object when the store holds %s', async (_, stored) => {
    const accountId = await owner();
    const body = randomBytes(64);
    const { documentId } = await created(accountId, body);
    const pathname = await objectKeyOf(documentId);
    const bytes = stored(body);
    if (bytes !== undefined) putObject(objects, pathname, bytes);
    expect(await documents.confirm(accountId, documentId)).toBe('mismatch');
    expect(await admin(`SELECT id FROM vault.document WHERE id = $1`, [documentId])).toEqual([]);
    expect(await objects.digest(pathname)).toBeUndefined();
    expect(await events(accountId)).toEqual([]);
  });

  it("finds nothing to confirm in another account's document", async () => {
    const accountId = await owner();
    const stranger = await owner();
    const body = randomBytes(64);
    const { documentId } = await created(accountId, body);
    putObject(objects, await objectKeyOf(documentId), body);
    expect(await documents.confirm(stranger, documentId)).toBe('not_found');
    expect(await documents.confirm(accountId, documentId)).toBe('confirmed');
  });
});

describe('listing and downloading documents (spec 0005, R4)', () => {
  it('lists owned and shared confirmed documents, the shares only to the owner', async () => {
    const accountId = await owner();
    const relative = await owner();
    const stranger = await owner();
    await link(accountId, relative);
    const mine = await confirmed(accountId);
    await created(accountId, randomBytes(8));
    await share(mine, accountId, relative);
    const theirs = await confirmed(relative);

    const owned = await documents.list(accountId, undefined);
    expect(
      owned.documents.map(({ id, ownerId, sharedWith }) => ({ id, ownerId, sharedWith })),
    ).toEqual([{ id: mine, ownerId: accountId, sharedWith: [relative] }]);
    expect(owned.next).toBeNull();
    const received = (await documents.list(relative, undefined)).documents.map(
      ({ id, sharedWith }) => ({ id, sharedWith }),
    );
    expect(received).toEqual(
      [
        { id: mine, sharedWith: [] },
        { id: theirs, sharedWith: [] },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect((await documents.list(stranger, undefined)).documents).toEqual([]);
  });

  it('pages by document ID', async () => {
    const accountId = await owner();
    await admin(
      `INSERT INTO vault.document (owner_id, type_key, size, sha256, object_key, confirmed_at)
       SELECT $1, 'passport', 1, $2, 'documents/' || gen_random_uuid(), now()
         FROM generate_series(1, $3)`,
      [accountId, randomBytes(32), documentPageSize + 1],
    );
    const first = await documents.list(accountId, undefined);
    expect(first.documents).toHaveLength(documentPageSize);
    expect(first.next).toBe(first.documents.at(-1)?.id);
    const second = await documents.list(accountId, first.next ?? undefined);
    expect(second.documents).toHaveLength(1);
    expect(second.next).toBeNull();
    expect(first.documents.map(({ id }) => id)).not.toContain(second.documents[0]?.id);
  });

  it('gives a recorded download URL to the owner and a recipient, and nothing to others', async () => {
    const accountId = await owner();
    const relative = await owner();
    const stranger = await owner();
    await link(accountId, relative);
    const documentId = await confirmed(accountId);
    await share(documentId, accountId, relative);
    const pending = (await created(accountId, randomBytes(8))).documentId;

    expect(await documents.downloadUrl(accountId, documentId)).toMatch(/^\/internal\/objects\//);
    expect(await documents.downloadUrl(relative, documentId)).toMatch(/^\/internal\/objects\//);
    expect(await documents.downloadUrl(stranger, documentId)).toBeUndefined();
    expect(await documents.downloadUrl(accountId, pending)).toBeUndefined();
    const issued = { code: 'document_download_url_issued', details: { documentId } };
    expect(await events(accountId)).toContainEqual(issued);
    expect(await events(relative)).toEqual([issued]);
    expect(await events(stranger)).toEqual([]);
  });
});

describe('the jobs on stored objects (spec 0005, R4)', () => {
  const putFor = async (documentId: string) => {
    const pathname = await objectKeyOf(documentId);
    putObject(objects, pathname, randomBytes(8));
    return pathname;
  };

  it('expires pending documents 24 hours old with their objects, and keeps the rest', async () => {
    const accountId = await owner();
    const now = new Date(Date.now() + 3_600_000);
    const old = (await created(accountId, randomBytes(8))).documentId;
    const young = (await created(accountId, randomBytes(8))).documentId;
    const kept = await confirmed(accountId, randomBytes(8));
    await admin(`UPDATE vault.document SET created_at = $2 WHERE id = ANY ($1)`, [
      [old, kept],
      new Date(now.getTime() - 24 * 3_600_000),
    ]);
    await admin(`UPDATE vault.document SET created_at = $2 WHERE id = $1`, [
      young,
      new Date(now.getTime() - 23 * 3_600_000),
    ]);
    const oldObject = await putFor(old);
    const youngObject = await putFor(young);

    expect(await jobs.expirePending(accountId, now)).toBe(1);
    const left = await admin<{ id: string }>(
      `SELECT id FROM vault.document WHERE owner_id = $1 ORDER BY id`,
      [accountId],
    );
    expect(left.map(({ id }) => id)).toEqual([young, kept].sort());
    expect(await objects.digest(oldObject)).toBeUndefined();
    expect(await objects.digest(youngObject)).toBeDefined();
    expect(await jobs.expirePending(accountId, now)).toBe(0);
  });

  it('erases the objects of every document the account owns, and not those it receives', async () => {
    const accountId = await owner();
    const relative = await owner();
    await link(relative, accountId);
    const received = await confirmed(relative);
    await share(received, relative, accountId);
    const owned = [
      await confirmed(accountId),
      (await created(accountId, randomBytes(8))).documentId,
    ];
    const pending = await putFor(owned[1] ?? 'missing');

    await jobs.eraseObjects(accountId);
    expect(await objects.digest(await objectKeyOf(owned[0] ?? 'missing'))).toBeUndefined();
    expect(await objects.digest(pending)).toBeUndefined();
    expect(await objects.digest(await objectKeyOf(received))).toBeDefined();
  });
});
