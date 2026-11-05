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

  it('presigns nothing an hour after create, so every grant ends before the daily cleanup', async () => {
    const accountId = await owner();
    const { documentId } = await created(accountId, randomBytes(8));
    await admin(
      `UPDATE vault.document SET created_at = now() - interval '61 minutes' WHERE id = $1`,
      [documentId],
    );
    expect(await documents.presignUpload(accountId, await objectKeyOf(documentId))).toBeUndefined();
    expect(presigned).toEqual([]);
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
  ])(
    'deletes the object and keeps the document pending when the store holds %s',
    async (_, stored) => {
      const accountId = await owner();
      const body = randomBytes(64);
      const { documentId } = await created(accountId, body);
      const pathname = await objectKeyOf(documentId);
      putObject(objects, pathname, stored(body));
      expect(await documents.confirm(accountId, documentId)).toBe('mismatch');
      expect(
        await admin(`SELECT confirmed_at FROM vault.document WHERE id = $1`, [documentId]),
      ).toEqual([{ confirmed_at: null }]);
      expect(await objects.digest(pathname)).toBeUndefined();
      expect(await events(accountId)).toEqual([]);
    },
  );

  it('keeps a document confirmed before its upload, so an upload under a live grant still has its row', async () => {
    const accountId = await owner();
    const body = randomBytes(64);
    const { documentId } = await created(accountId, body);
    expect(await documents.confirm(accountId, documentId)).toBe('not_uploaded');
    putObject(objects, await objectKeyOf(documentId), body);
    expect(await documents.confirm(accountId, documentId)).toBe('confirmed');
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

describe('replacing, sharing and deleting documents (spec 0005, R4)', () => {
  const replacementOf = async (documentId: string) =>
    (
      await admin<{ object_key: string; size: number; recipients: string[] }>(
        `SELECT object_key, size, recipients FROM vault.document_replacement WHERE document_id = $1`,
        [documentId],
      )
    )[0];
  const sharesOf = async (documentId: string) =>
    (
      await admin<{ recipient_id: string }>(
        `SELECT recipient_id FROM vault.document_recipient WHERE document_id = $1 ORDER BY 1`,
        [documentId],
      )
    ).map(({ recipient_id }) => recipient_id);
  const discardedOf = async (accountId: string) =>
    (
      await admin<{ object_key: string }>(
        `SELECT object_key FROM vault.discarded_object WHERE owner_id = $1 ORDER BY 1`,
        [accountId],
      )
    ).map(({ object_key }) => object_key);

  async function replacing(
    accountId: string,
    recipients: string[],
    bodies: readonly (readonly [string, Uint8Array])[],
  ) {
    return documents.replace(accountId, {
      recipients: [...recipients].sort(),
      documents: bodies.map(([documentId, body]) => ({
        documentId,
        size: body.length,
        sha256: sha256Of(body),
      })),
    });
  }

  /** Uploads each body to its replacement's pathname, as the device does. */
  async function uploadReplacements(bodies: readonly (readonly [string, Uint8Array])[]) {
    for (const [documentId, body] of bodies) {
      putObject(objects, (await replacementOf(documentId))?.object_key ?? 'missing', body);
    }
  }

  it('swaps in the approved ciphertext and sets the shares to its recipients', async () => {
    const accountId = await owner();
    const [kept, revoked, added] = [await owner(), await owner(), await owner()];
    for (const relative of [kept, revoked, added]) await link(accountId, relative);
    const documentId = await confirmed(accountId);
    const before = await objectKeyOf(documentId);
    await share(documentId, accountId, kept);
    await share(documentId, accountId, revoked);
    const body = randomBytes(80);

    const started = await replacing(accountId, [kept, added], [[documentId, body]]);
    expect(typeof started).toBe('object');
    expect((await replacementOf(documentId))?.size).toBe(80);
    await uploadReplacements([[documentId, body]]);
    expect(await documents.confirmReplacements(accountId, [documentId])).toEqual({
      results: [{ documentId, outcome: 'replaced' }],
    });

    const after = await objectKeyOf(documentId);
    expect(after).not.toBe(before);
    expect(await objects.digest(after)).toEqual({
      size: 80,
      sha256: createHash('sha256').update(body).digest(),
    });
    expect(await objects.digest(before)).toBeUndefined();
    expect(await discardedOf(accountId)).toEqual([before]);
    expect(await replacementOf(documentId)).toBeUndefined();
    expect(await sharesOf(documentId)).toEqual([kept, added].sort());
    const trail = (await events(accountId)).filter(({ code }) => code !== 'document_created');
    expect(trail).toEqual(
      expect.arrayContaining([
        { code: 'document_replaced', details: { documentId } },
        { code: 'document_shared', details: { documentId, recipientId: added } },
        { code: 'document_share_revoked', details: { documentId, recipientId: revoked } },
      ]),
    );
    expect(trail).toHaveLength(3);
    expect((await documents.list(revoked, undefined)).documents).toEqual([]);
    expect(await documents.downloadUrl(revoked, documentId)).toBeUndefined();
  });

  it('presigns a replacement for its approved size, only in the hour after approval', async () => {
    const accountId = await owner();
    const documentId = await confirmed(accountId);
    await replacing(accountId, [], [[documentId, randomBytes(70)]]);
    const pathname = (await replacementOf(documentId))?.object_key ?? 'missing';
    expect(await documents.presignUpload(accountId, pathname)).toEqual(fakePresigned);
    expect(presigned).toEqual([{ pathname, maxBytes: 70 }]);
    await admin(
      `UPDATE vault.document_replacement SET created_at = now() - interval '61 minutes'
        WHERE document_id = $1`,
      [documentId],
    );
    expect(await documents.presignUpload(accountId, pathname)).toBeUndefined();
  });

  it.each([
    ['a pending document', 'pending'],
    ["another account's document", 'foreign'],
    ['an account it has no link to', 'unlinked'],
  ] as const)('approves nothing for %s', async (_, refused) => {
    const accountId = await owner();
    const stranger = await owner();
    const documentId = await confirmed(accountId);
    const other =
      refused === 'pending'
        ? (await created(accountId, randomBytes(8))).documentId
        : refused === 'foreign'
          ? await confirmed(stranger)
          : await confirmed(accountId);
    const outcome = await replacing(accountId, refused === 'unlinked' ? [stranger] : [], [
      [documentId, randomBytes(8)],
      [other, randomBytes(8)],
    ]);
    expect(outcome).toBe(refused === 'unlinked' ? 'not_linked' : 'not_found');
    expect(await replacementOf(documentId)).toBeUndefined();
  });

  it('counts replacements against the quota, and keeps an earlier one when refusing', async () => {
    const accountId = await owner();
    const documentId = await confirmed(accountId, randomBytes(64));
    await replacing(accountId, [], [[documentId, randomBytes(100)]]);
    const earlier = await replacementOf(documentId);
    const full = Math.floor((documentQuota.bytes - 64) / maxDocumentBytes);
    await admin(
      `INSERT INTO vault.document (owner_id, type_key, size, sha256, object_key)
       SELECT $1, 'passport', $2, $3, 'documents/' || gen_random_uuid()
         FROM generate_series(1, $4)`,
      [accountId, maxDocumentBytes, randomBytes(32), full],
    );
    const left = documentQuota.bytes - 64 - full * maxDocumentBytes;
    const sha256 = sha256Of(randomBytes(1));
    expect(
      await documents.create(accountId, { typeKey: 'passport', size: left - 99, sha256 }),
    ).toBe('over_quota');
    expect(
      await documents.replace(accountId, {
        recipients: [],
        documents: [{ documentId, size: left + 1, sha256 }],
      }),
    ).toBe('over_quota');
    expect(await replacementOf(documentId)).toEqual(earlier);
    expect(
      typeof (await documents.replace(accountId, {
        recipients: [],
        documents: [{ documentId, size: left, sha256 }],
      })),
    ).toBe('object');
  });

  it('discards an earlier replacement still unconfirmed when a new one is approved', async () => {
    const accountId = await owner();
    const documentId = await confirmed(accountId);
    const first = randomBytes(30);
    await replacing(accountId, [], [[documentId, first]]);
    await uploadReplacements([[documentId, first]]);
    const earlier = (await replacementOf(documentId))?.object_key ?? 'missing';
    await replacing(accountId, [], [[documentId, randomBytes(40)]]);
    expect((await replacementOf(documentId))?.size).toBe(40);
    expect(await objects.digest(earlier)).toBeUndefined();
    expect(await discardedOf(accountId)).toEqual([earlier]);
  });

  it('keeps a replacement until its upload matches, and deletes an upload that does not', async () => {
    const accountId = await owner();
    const documentId = await confirmed(accountId);
    const before = await objectKeyOf(documentId);
    const body = randomBytes(50);
    await replacing(accountId, [], [[documentId, body]]);
    const pathname = (await replacementOf(documentId))?.object_key ?? 'missing';
    const unreplaced = await confirmed(accountId);
    expect(await documents.confirmReplacements(accountId, [documentId, unreplaced])).toEqual({
      results: [
        { documentId, outcome: 'not_uploaded' },
        { documentId: unreplaced, outcome: 'not_found' },
      ],
    });
    putObject(objects, pathname, Buffer.from(body).reverse());
    expect(await documents.confirmReplacements(accountId, [documentId])).toEqual({
      results: [{ documentId, outcome: 'mismatch' }],
    });
    expect(await objects.digest(pathname)).toBeUndefined();
    expect(await replacementOf(documentId)).toBeDefined();
    expect(await objectKeyOf(documentId)).toBe(before);
  });

  it('deletes documents with their shares, replacements and objects, all or none', async () => {
    const accountId = await owner();
    const relative = await owner();
    const stranger = await owner();
    await link(accountId, relative);
    const shared = await confirmed(accountId);
    await share(shared, accountId, relative);
    await replacing(accountId, [relative], [[shared, randomBytes(20)]]);
    const replacementKey = (await replacementOf(shared))?.object_key ?? 'missing';
    putObject(objects, replacementKey, randomBytes(20));
    const pending = (await created(accountId, randomBytes(8))).documentId;
    const keys = [await objectKeyOf(shared), await objectKeyOf(pending), replacementKey];
    const foreign = await confirmed(stranger);

    expect(await documents.delete(accountId, [shared, foreign])).toBe('not_found');
    expect(await documents.delete(relative, [shared])).toBe('not_found');
    expect(await objects.digest(keys[0] ?? 'missing')).toBeDefined();

    expect(await documents.delete(accountId, [shared, pending])).toBe('deleted');
    expect(
      await admin(`SELECT id FROM vault.document WHERE id = ANY ($1)`, [[shared, pending]]),
    ).toEqual([]);
    expect(await sharesOf(shared)).toEqual([]);
    expect(await replacementOf(shared)).toBeUndefined();
    for (const key of keys) expect(await objects.digest(key), key).toBeUndefined();
    expect(await discardedOf(accountId)).toEqual([...keys].sort());
    const deleted = (await events(accountId)).filter(({ code }) => code === 'document_deleted');
    expect(deleted).toEqual(
      expect.arrayContaining([
        { code: 'document_deleted', details: { documentId: shared } },
        { code: 'document_deleted', details: { documentId: pending } },
      ]),
    );
    expect(await objects.digest(await objectKeyOf(foreign))).toBeDefined();
  });

  it('deletes discarded objects again once their grants have ended, and stale replacements', async () => {
    const accountId = await owner();
    const now = new Date(Date.now() + 3_600_000);
    const deleted = await confirmed(accountId);
    const late = await objectKeyOf(deleted);
    await documents.delete(accountId, [deleted]);
    // A late upload under a grant issued before the delete.
    putObject(objects, late, randomBytes(8));
    const stale = await confirmed(accountId);
    await replacing(accountId, [], [[stale, randomBytes(8)]]);
    const staleKey = (await replacementOf(stale))?.object_key ?? 'missing';
    putObject(objects, staleKey, randomBytes(8));
    await admin(`UPDATE vault.document_replacement SET created_at = $2 WHERE document_id = $1`, [
      stale,
      new Date(now.getTime() - 24 * 3_600_000),
    ]);
    await admin(`UPDATE vault.discarded_object SET discarded_at = $2 WHERE object_key = $1`, [
      late,
      new Date(now.getTime() - 61 * 60_000),
    ]);

    expect(await jobs.expirePending(accountId, now)).toBe(2);
    expect(await objects.digest(late)).toBeUndefined();
    expect(await objects.digest(staleKey)).toBeUndefined();
    expect(await discardedOf(accountId)).toEqual([]);
    expect(await replacementOf(stale)).toBeUndefined();
    expect(await objects.digest(await objectKeyOf(stale))).toBeDefined();
  });

  it('erases the objects of replacements and discarded objects with the account', async () => {
    const accountId = await owner();
    const documentId = await confirmed(accountId);
    await replacing(accountId, [], [[documentId, randomBytes(8)]]);
    const replacementKey = (await replacementOf(documentId))?.object_key ?? 'missing';
    putObject(objects, replacementKey, randomBytes(8));
    const deleted = await confirmed(accountId);
    const discarded = await objectKeyOf(deleted);
    await documents.delete(accountId, [deleted]);
    putObject(objects, discarded, randomBytes(8));

    await jobs.eraseObjects(accountId);
    for (const key of [replacementKey, discarded, await objectKeyOf(documentId)]) {
      expect(await objects.digest(key), key).toBeUndefined();
    }
  });
});
