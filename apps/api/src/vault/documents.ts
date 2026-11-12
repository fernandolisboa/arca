import { randomUUID } from 'node:crypto';
import {
  documentPageSize,
  documentQuota,
  type ConfirmReplacementsResponse,
  type CreateDocumentRequest,
  type CreateDocumentResponse,
  type DocumentsResponse,
  type DocumentUploadUrlResponse,
  type ReplaceDocumentsRequest,
  type ReplaceDocumentsResponse,
} from '@arca/api-contract/routes';
import { withIdentity, type Database, type Transaction } from '@arca/db';
import { sql, type SQL } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import { ciphertextType, type ObjectStorage } from './object-storage.js';

export type DocumentCreated = CreateDocumentResponse | 'no_vault' | 'over_quota';
export type UploadConfirmed = 'confirmed' | 'not_found' | 'not_uploaded' | 'mismatch';
export type ReplacementStarted =
  ReplaceDocumentsResponse | 'not_found' | 'not_linked' | 'over_quota';
export type ReplacementOutcome = ConfirmReplacementsResponse['results'][number]['outcome'];

/** Documents in the vault (spec 0005, R4): metadata here, ciphertext in the object store. */
export interface DocumentRequests {
  /** Adds a pending document, which counts against the quota from now on. */
  readonly create: (accountId: string, request: CreateDocumentRequest) => Promise<DocumentCreated>;
  /**
   * The presigned upload for the account's pending document at this pathname, while the document is
   * younger than `uploadWindowMinutes`.
   */
  readonly presignUpload: (
    accountId: string,
    pathname: string,
  ) => Promise<DocumentUploadUrlResponse | undefined>;
  /**
   * Confirms a pending upload whose stored object has the declared size and SHA-256. Any other
   * object is deleted and the document stays pending: its row is deleted only by the daily
   * cleanup, after every upload grant for it has ended, so no object outlives the row naming it.
   */
  readonly confirm: (accountId: string, documentId: string) => Promise<UploadConfirmed>;
  /** A page of the confirmed documents the account owns or that are shared with it. */
  readonly list: (accountId: string, after: string | undefined) => Promise<DocumentsResponse>;
  /** A download URL for a confirmed document the account owns or receives, recorded. */
  readonly downloadUrl: (accountId: string, documentId: string) => Promise<string | undefined>;
  /**
   * Approves new ciphertext for the account's confirmed documents, encrypted to these linked
   * accounts, replacing any replacement still unconfirmed; all of them or none.
   */
  readonly replace: (
    accountId: string,
    request: ReplaceDocumentsRequest,
  ) => Promise<ReplacementStarted>;
  /**
   * Swaps in each replacement whose stored object has the approved size and SHA-256, sets the
   * document's shares to its recipients and deletes the old object; any other object is deleted
   * and the replacement stays until the daily cleanup.
   */
  readonly confirmReplacements: (
    accountId: string,
    documentIds: readonly string[],
  ) => Promise<ConfirmReplacementsResponse>;
  /** Deletes the account's documents, all of them or none, with their shares and objects. */
  readonly delete: (
    accountId: string,
    documentIds: readonly string[],
  ) => Promise<'deleted' | 'not_found'>;
}

/** What the jobs do to stored objects, on the app_jobs pool. */
export interface DocumentObjects {
  /**
   * Deletes every object a row of the account names, pending documents, replacements and
   * discarded objects included, before erasure deletes the rows (spec 0004, R9).
   */
  readonly eraseObjects: (accountId: string) => Promise<void>;
  /**
   * The daily cleanup of the account's objects, each object before its row: pending documents
   * and replacements 24 hours old, and discarded objects once every grant for them has ended.
   */
  readonly expirePending: (accountId: string, now: Date) => Promise<number>;
}

export type Documents = DocumentRequests & DocumentObjects;

export interface DocumentSettings {
  /** A database on the app_api pool for requests, or on the app_jobs pool for the jobs. */
  readonly db: Database;
  readonly storage: ObjectStorage;
  readonly audit: AuditLog;
}

/** Pending documents older than this are deleted by the daily cleanup (RETENTION.md). */
export const pendingDocumentHours = 24;

/** Uploads are presigned only this long after create, so every grant ends before the cleanup. */
export const uploadWindowMinutes = 60;

/**
 * A discarded object is deleted again this long after it was discarded: no grant is issued for
 * it any more, and one issued before lasts 5 minutes.
 */
export const discardedObjectMinutes = 60;

/**
 * An upload is confirmed only this long after its row was made, so a confirm never races the
 * daily cleanup deleting the same object at 24 hours.
 */
export const confirmWindowHours = 2;

const listOf = (values: readonly string[]): SQL =>
  sql`(${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`;

const uuidArray = (values: readonly string[]): SQL =>
  values.length === 0
    ? sql`'{}'::uuid[]`
    : sql`ARRAY[${sql.join(
        values.map((value) => sql`${value}::uuid`),
        sql`, `,
      )}]`;

interface DocumentRow extends Record<string, unknown> {
  readonly id: string;
  readonly owner_id: string;
  readonly type_key: string;
  readonly size: number;
  readonly sha256: Buffer;
  readonly label: Buffer;
  readonly created_at: Date;
  readonly shared_with: string[];
}

export function createDocuments({ db, storage, audit }: DocumentSettings): Documents {
  const asAccount = <T>(accountId: string, work: (tx: Transaction) => Promise<T>) =>
    withIdentity(db, { accountId }, work);

  const pending = async (tx: Transaction, accountId: string, where: SQL) =>
    (
      await tx.execute<{ id: string; object_key: string; size: number; sha256: Buffer }>(sql`
        SELECT id, object_key, size, sha256 FROM vault.document
         WHERE owner_id = ${accountId} AND confirmed_at IS NULL AND ${where}`)
    ).rows[0];

  /**
   * The current recipient's lock queues the account's creates and replaces, so the quota holds,
   * and orders them with a vault reset, which takes it before checking for documents.
   */
  const lockVault = async (tx: Transaction, accountId: string) =>
    (
      await tx.execute<{ id: string }>(sql`
        SELECT id FROM vault.recipient
         WHERE account_id = ${accountId} AND rotated_at IS NULL FOR UPDATE`)
    ).rows.length > 0;

  /** Documents and bytes held, replacements included, leaving out the replacements of `except`. */
  const usage = async (tx: Transaction, accountId: string, except: readonly string[] = []) => {
    const [row] = (
      await tx.execute<{ documents: number; bytes: string }>(sql`
        SELECT (SELECT count(*)::int FROM vault.document WHERE owner_id = ${accountId}) AS documents,
               ((SELECT coalesce(sum(size), 0) FROM vault.document WHERE owner_id = ${accountId})
                + (SELECT coalesce(sum(size), 0) FROM vault.document_replacement
                    WHERE owner_id = ${accountId}
                      ${except.length === 0 ? sql`` : sql`AND document_id NOT IN ${listOf(except)}`})
               )::text AS bytes`)
    ).rows;
    return { documents: row?.documents ?? 0, bytes: BigInt(row?.bytes ?? '0') };
  };

  /** Records objects deleted while a grant for them may be live, for the cleanup to delete again. */
  const discard = async (tx: Transaction, accountId: string, keys: readonly string[]) => {
    if (keys.length === 0) return;
    await tx.execute(sql`
      INSERT INTO vault.discarded_object (object_key, owner_id)
      VALUES ${sql.join(
        keys.map((key) => sql`(${key}, ${accountId})`),
        sql`, `,
      )}`);
  };

  /** Whether the account has a link, in either direction, to each of these accounts. */
  const allLinked = async (tx: Transaction, accountId: string, ids: readonly string[]) => {
    if (ids.length === 0) return true;
    const [linked] = (
      await tx.execute<{ accounts: number }>(sql`
        SELECT count(DISTINCT CASE WHEN inviter_id = ${accountId} THEN invitee_id
                                   ELSE inviter_id END)::int AS accounts
          FROM account.link
         WHERE (inviter_id = ${accountId} AND invitee_id IN ${listOf(ids)})
            OR (invitee_id = ${accountId} AND inviter_id IN ${listOf(ids)})`)
    ).rows;
    return linked?.accounts === ids.length;
  };

  const confirmable = sql`created_at > now() - make_interval(hours => ${confirmWindowHours})`;

  const record = (
    accountId: string,
    event:
      | { code: 'document_replaced' | 'document_deleted'; details: { documentId: string } }
      | {
          code: 'document_shared' | 'document_share_revoked';
          details: { documentId: string; recipientId: string };
        },
  ) => audit.record({ ...event, subjectAccountId: accountId, actorAccountId: accountId });

  async function confirmReplacement(
    accountId: string,
    documentId: string,
  ): Promise<ReplacementOutcome> {
    const found = await asAccount(
      accountId,
      async (tx) =>
        (
          await tx.execute<{ object_key: string; size: number; sha256: Buffer; label: Buffer }>(sql`
            SELECT object_key, size, sha256, label FROM vault.document_replacement
             WHERE document_id = ${documentId} AND owner_id = ${accountId} AND ${confirmable}`)
        ).rows[0],
    );
    if (found === undefined) return 'not_found';
    const stored = await storage.digest(found.object_key);
    if (stored === undefined) return 'not_uploaded';
    if (stored.size !== found.size || !stored.sha256.equals(found.sha256)) {
      await storage.delete([found.object_key]);
      return 'mismatch';
    }
    const replaced = await asAccount(accountId, async (tx) => {
      const [current] = (
        await tx.execute<{ object_key: string }>(sql`
          SELECT object_key FROM vault.document
           WHERE id = ${documentId} AND owner_id = ${accountId} FOR UPDATE`)
      ).rows;
      const [taken] = (
        await tx.execute<{ recipients: string[] }>(sql`
          DELETE FROM vault.document_replacement
           WHERE document_id = ${documentId} AND owner_id = ${accountId}
             AND object_key = ${found.object_key}
          RETURNING recipients`)
      ).rows;
      if (current === undefined || taken === undefined) return undefined;
      const shared = (
        await tx.execute<{ recipient_id: string }>(sql`
          SELECT recipient_id FROM vault.document_recipient WHERE document_id = ${documentId}`)
      ).rows.map(({ recipient_id }) => recipient_id);
      const revoked = shared.filter((id) => !taken.recipients.includes(id));
      const added = taken.recipients.filter((id) => !shared.includes(id));
      // A recipient whose link went since the approval (an erased account) ends this replacement.
      if (!(await allLinked(tx, accountId, added))) {
        await discard(tx, accountId, [found.object_key]);
        return { outcome: 'not_linked' as const, deletes: found.object_key };
      }
      await tx.execute(sql`
        UPDATE vault.document
           SET object_key = ${found.object_key}, size = ${found.size}, sha256 = ${found.sha256},
               label = ${found.label}
         WHERE id = ${documentId} AND owner_id = ${accountId}`);
      await discard(tx, accountId, [current.object_key]);
      if (revoked.length > 0) {
        await tx.execute(sql`
          DELETE FROM vault.document_recipient
           WHERE document_id = ${documentId} AND recipient_id IN ${listOf(revoked)}`);
      }
      for (const recipientId of added) {
        await tx.execute(sql`
          INSERT INTO vault.document_recipient (document_id, document_owner_id, recipient_id)
          VALUES (${documentId}, ${accountId}, ${recipientId})`);
      }
      await record(accountId, { code: 'document_replaced', details: { documentId } });
      for (const recipientId of added) {
        await record(accountId, { code: 'document_shared', details: { documentId, recipientId } });
      }
      for (const recipientId of revoked) {
        await record(accountId, {
          code: 'document_share_revoked',
          details: { documentId, recipientId },
        });
      }
      return { outcome: 'replaced' as const, deletes: current.object_key };
    });
    if (replaced === undefined) return 'not_found';
    await storage.delete([replaced.deletes]);
    return replaced.outcome;
  }

  /** Deletes the objects that `select` finds, then their rows with `remove`; returns how many. */
  async function expire(
    accountId: string,
    select: SQL,
    remove: (keys: readonly string[]) => SQL,
  ): Promise<number> {
    const keys = await asAccount(accountId, async (tx) =>
      (await tx.execute<{ object_key: string }>(select)).rows.map(({ object_key }) => object_key),
    );
    if (keys.length === 0) return 0;
    await storage.delete(keys);
    await asAccount(accountId, (tx) => tx.execute(remove(keys)));
    return keys.length;
  }

  return {
    create: (accountId, { typeKey, size, sha256, label }) =>
      asAccount(accountId, async (tx) => {
        if (!(await lockVault(tx, accountId))) return 'no_vault' as const;
        const held = await usage(tx, accountId);
        if (
          held.documents >= documentQuota.documents ||
          held.bytes + BigInt(size) > BigInt(documentQuota.bytes)
        ) {
          return 'over_quota' as const;
        }
        const objectKey = `documents/${randomUUID()}`;
        // Raw SQL: app_api may insert only these columns, and Drizzle would list them all.
        const [row] = (
          await tx.execute<{ id: string }>(sql`
            INSERT INTO vault.document (owner_id, type_key, size, sha256, object_key, label)
            VALUES (${accountId}, ${typeKey}, ${size}, ${Buffer.from(sha256, 'base64url')},
                    ${objectKey}, ${Buffer.from(label, 'base64url')})
            RETURNING id`)
        ).rows;
        if (row === undefined) throw new Error('the document was not inserted');
        return { documentId: row.id, upload: storage.uploadTarget(objectKey, size) };
      }),

    async presignUpload(accountId, pathname) {
      const recent = sql`created_at > now() - make_interval(mins => ${uploadWindowMinutes})`;
      const [found] = await asAccount(
        accountId,
        async (tx) =>
          (
            await tx.execute<{ size: number }>(sql`
              SELECT size FROM vault.document
               WHERE owner_id = ${accountId} AND confirmed_at IS NULL
                 AND object_key = ${pathname} AND ${recent}
              UNION ALL
              SELECT size FROM vault.document_replacement
               WHERE owner_id = ${accountId} AND object_key = ${pathname} AND ${recent}`)
          ).rows,
      );
      return found === undefined
        ? undefined
        : storage.presignUpload(pathname, found.size, ciphertextType);
    },

    async confirm(accountId, documentId) {
      const found = await asAccount(accountId, (tx) =>
        pending(tx, accountId, sql`id = ${documentId} AND ${confirmable}`),
      );
      if (found === undefined) return 'not_found';
      const stored = await storage.digest(found.object_key);
      if (stored === undefined) return 'not_uploaded';
      if (stored.size !== found.size || !stored.sha256.equals(found.sha256)) {
        await storage.delete([found.object_key]);
        return 'mismatch';
      }
      return asAccount(accountId, async (tx) => {
        const confirmed = await tx.execute<{ id: string }>(sql`
          UPDATE vault.document SET confirmed_at = now()
           WHERE id = ${documentId} AND owner_id = ${accountId} AND confirmed_at IS NULL
          RETURNING id`);
        if (confirmed.rows.length === 0) return 'not_found';
        await audit.record({
          code: 'document_created',
          subjectAccountId: accountId,
          actorAccountId: accountId,
          details: { documentId },
        });
        return 'confirmed';
      });
    },

    list: (accountId, after) =>
      asAccount(accountId, async (tx) => {
        // Row-level security limits this to owned documents and those shared with the account.
        const rows = (
          await tx.execute<DocumentRow>(sql`
            SELECT d.id, d.owner_id, d.type_key, d.size, d.sha256, d.label, d.created_at,
                   CASE WHEN d.owner_id = ${accountId} THEN coalesce(
                     (SELECT array_agg(r.recipient_id ORDER BY r.recipient_id)
                        FROM vault.document_recipient r WHERE r.document_id = d.id),
                     '{}') ELSE '{}' END AS shared_with
              FROM vault.document d
             WHERE d.confirmed_at IS NOT NULL
               ${after === undefined ? sql`` : sql`AND d.id > ${after}`}
             ORDER BY d.id
             LIMIT ${documentPageSize + 1}`)
        ).rows;
        const page = rows.slice(0, documentPageSize);
        return {
          documents: page.map((row) => ({
            id: row.id,
            typeKey: row.type_key,
            size: row.size,
            sha256: row.sha256.toString('base64url'),
            label: row.label.toString('base64url'),
            createdAt: new Date(row.created_at).toISOString(),
            ownerId: row.owner_id,
            sharedWith: row.shared_with,
          })),
          next: rows.length > documentPageSize ? (page.at(-1)?.id ?? null) : null,
        };
      }),

    async downloadUrl(accountId, documentId) {
      const objectKey = await asAccount(accountId, async (tx) => {
        const [row] = (
          await tx.execute<{ object_key: string }>(sql`
            SELECT object_key FROM vault.document
             WHERE id = ${documentId} AND confirmed_at IS NOT NULL`)
        ).rows;
        if (row === undefined) return undefined;
        await audit.record({
          code: 'document_download_url_issued',
          subjectAccountId: accountId,
          actorAccountId: accountId,
          details: { documentId },
        });
        return row.object_key;
      });
      return objectKey === undefined ? undefined : storage.downloadUrl(objectKey);
    },

    async replace(accountId, { recipients, documents }) {
      const ids = documents.map(({ documentId }) => documentId);
      const discarded: string[] = [];
      const outcome = await asAccount(accountId, async (tx): Promise<ReplacementStarted> => {
        if (!(await lockVault(tx, accountId))) return 'not_found';
        const owned = await tx.execute<{ id: string }>(sql`
          SELECT id FROM vault.document
           WHERE owner_id = ${accountId} AND confirmed_at IS NOT NULL AND id IN ${listOf(ids)}
           FOR UPDATE`);
        if (owned.rows.length !== ids.length) return 'not_found';
        if (!(await allLinked(tx, accountId, recipients))) return 'not_linked';
        const held = await usage(tx, accountId, ids);
        const adding = documents.reduce((sum, { size }) => sum + BigInt(size), 0n);
        if (held.bytes + adding > BigInt(documentQuota.bytes)) return 'over_quota';
        const earlier = (
          await tx.execute<{ object_key: string }>(sql`
            DELETE FROM vault.document_replacement
             WHERE owner_id = ${accountId} AND document_id IN ${listOf(ids)}
            RETURNING object_key`)
        ).rows.map(({ object_key }) => object_key);
        await discard(tx, accountId, earlier);
        discarded.push(...earlier);
        const uploads = [];
        for (const { documentId, size, sha256, label } of documents) {
          const objectKey = `documents/${randomUUID()}`;
          await tx.execute(sql`
            INSERT INTO vault.document_replacement
              (document_id, owner_id, size, sha256, object_key, label, recipients)
            VALUES (${documentId}, ${accountId}, ${size}, ${Buffer.from(sha256, 'base64url')},
                    ${objectKey}, ${Buffer.from(label, 'base64url')}, ${uuidArray(recipients)})`);
          uploads.push({ documentId, upload: storage.uploadTarget(objectKey, size) });
        }
        return { uploads };
      });
      await storage.delete(discarded);
      return outcome;
    },

    async confirmReplacements(accountId, documentIds) {
      const results = [];
      for (const documentId of documentIds) {
        results.push({ documentId, outcome: await confirmReplacement(accountId, documentId) });
      }
      return { results };
    },

    async delete(accountId, documentIds) {
      const keys = await asAccount(accountId, async (tx) => {
        const found = (
          await tx.execute<{ id: string; object_key: string }>(sql`
            SELECT id, object_key FROM vault.document
             WHERE owner_id = ${accountId} AND id IN ${listOf(documentIds)}
             FOR UPDATE`)
        ).rows;
        if (found.length !== documentIds.length) return undefined;
        const replacements = (
          await tx.execute<{ object_key: string }>(sql`
            SELECT object_key FROM vault.document_replacement
             WHERE owner_id = ${accountId} AND document_id IN ${listOf(documentIds)}`)
        ).rows;
        const objects = [...found, ...replacements].map(({ object_key }) => object_key);
        await discard(tx, accountId, objects);
        // The shares and any replacement go with the row, through their cascades.
        await tx.execute(sql`
          DELETE FROM vault.document
           WHERE owner_id = ${accountId} AND id IN ${listOf(documentIds)}`);
        for (const documentId of documentIds) {
          await record(accountId, { code: 'document_deleted', details: { documentId } });
        }
        return objects;
      });
      if (keys === undefined) return 'not_found';
      await storage.delete(keys);
      return 'deleted';
    },

    async eraseObjects(accountId) {
      const keys = await asAccount(accountId, async (tx) =>
        (
          await tx.execute<{ object_key: string }>(sql`
            SELECT object_key FROM vault.document WHERE owner_id = ${accountId}
            UNION ALL
            SELECT object_key FROM vault.document_replacement WHERE owner_id = ${accountId}
            UNION ALL
            SELECT object_key FROM vault.discarded_object WHERE owner_id = ${accountId}`)
        ).rows.map(({ object_key }) => object_key),
      );
      await storage.delete(keys);
    },

    async expirePending(accountId, now) {
      const cutoff = new Date(now.getTime() - pendingDocumentHours * 3_600_000);
      const discardedBefore = new Date(now.getTime() - discardedObjectMinutes * 60_000);
      const documents = await expire(
        accountId,
        sql`SELECT object_key FROM vault.document
             WHERE owner_id = ${accountId} AND confirmed_at IS NULL AND created_at <= ${cutoff}`,
        (keys) => sql`DELETE FROM vault.document
                       WHERE owner_id = ${accountId} AND confirmed_at IS NULL
                         AND object_key IN ${listOf(keys)}`,
      );
      const replacements = await expire(
        accountId,
        sql`SELECT object_key FROM vault.document_replacement
             WHERE owner_id = ${accountId} AND created_at <= ${cutoff}`,
        (keys) => sql`DELETE FROM vault.document_replacement
                       WHERE owner_id = ${accountId} AND object_key IN ${listOf(keys)}`,
      );
      const discarded = await expire(
        accountId,
        sql`SELECT object_key FROM vault.discarded_object
             WHERE owner_id = ${accountId} AND discarded_at <= ${discardedBefore}`,
        (keys) => sql`DELETE FROM vault.discarded_object
                       WHERE owner_id = ${accountId} AND object_key IN ${listOf(keys)}`,
      );
      return documents + replacements + discarded;
    },
  };
}
