import { randomUUID } from 'node:crypto';
import {
  documentPageSize,
  documentQuota,
  type CreateDocumentRequest,
  type CreateDocumentResponse,
  type DocumentsResponse,
  type DocumentUploadUrlResponse,
} from '@arca/api-contract/routes';
import { withIdentity, type Database, type Transaction } from '@arca/db';
import { sql } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import type { ObjectStorage } from './object-storage.js';

export type DocumentCreated = CreateDocumentResponse | 'no_vault' | 'over_quota';
export type UploadConfirmed = 'confirmed' | 'not_found' | 'not_uploaded' | 'mismatch';

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
}

/** What the jobs do to stored objects, on the app_jobs pool. */
export interface DocumentObjects {
  /**
   * Deletes the objects of every document the account owns, pending ones included, before
   * erasure deletes the rows that name them (spec 0004, R9).
   */
  readonly eraseObjects: (accountId: string) => Promise<void>;
  /** Deletes the account's pending documents created 24 hours before `now`, objects first. */
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

interface DocumentRow extends Record<string, unknown> {
  readonly id: string;
  readonly owner_id: string;
  readonly type_key: string;
  readonly size: number;
  readonly sha256: Buffer;
  readonly created_at: Date;
  readonly shared_with: string[];
}

export function createDocuments({ db, storage, audit }: DocumentSettings): Documents {
  const asAccount = <T>(accountId: string, work: (tx: Transaction) => Promise<T>) =>
    withIdentity(db, { accountId }, work);

  const pending = async (tx: Transaction, accountId: string, where: ReturnType<typeof sql>) =>
    (
      await tx.execute<{ id: string; object_key: string; size: number; sha256: Buffer }>(sql`
        SELECT id, object_key, size, sha256 FROM vault.document
         WHERE owner_id = ${accountId} AND confirmed_at IS NULL AND ${where}`)
    ).rows[0];

  return {
    create: (accountId, { typeKey, size, sha256 }) =>
      asAccount(accountId, async (tx) => {
        // The current recipient's lock queues concurrent creates, so the quota holds, and orders
        // them with a vault reset, which takes it before checking for documents.
        const vault = await tx.execute<{ id: string }>(sql`
          SELECT id FROM vault.recipient
           WHERE account_id = ${accountId} AND rotated_at IS NULL FOR UPDATE`);
        if (vault.rows.length === 0) return 'no_vault' as const;
        const [usage] = (
          await tx.execute<{ documents: number; bytes: string }>(sql`
            SELECT count(*)::int AS documents, coalesce(sum(size), 0)::text AS bytes
              FROM vault.document WHERE owner_id = ${accountId}`)
        ).rows;
        if (
          (usage?.documents ?? 0) >= documentQuota.documents ||
          BigInt(usage?.bytes ?? '0') + BigInt(size) > BigInt(documentQuota.bytes)
        ) {
          return 'over_quota' as const;
        }
        const objectKey = `documents/${randomUUID()}`;
        // Raw SQL: app_api may insert only these columns, and Drizzle would list them all.
        const [row] = (
          await tx.execute<{ id: string }>(sql`
            INSERT INTO vault.document (owner_id, type_key, size, sha256, object_key)
            VALUES (${accountId}, ${typeKey}, ${size}, ${Buffer.from(sha256, 'base64url')}, ${objectKey})
            RETURNING id`)
        ).rows;
        if (row === undefined) throw new Error('the document was not inserted');
        return { documentId: row.id, upload: storage.uploadTarget(objectKey, size) };
      }),

    async presignUpload(accountId, pathname) {
      const found = await asAccount(accountId, (tx) =>
        pending(
          tx,
          accountId,
          sql`object_key = ${pathname}
              AND created_at > now() - make_interval(mins => ${uploadWindowMinutes})`,
        ),
      );
      return found === undefined ? undefined : storage.presignUpload(pathname, found.size);
    },

    async confirm(accountId, documentId) {
      const found = await asAccount(accountId, (tx) =>
        pending(tx, accountId, sql`id = ${documentId}`),
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
            SELECT d.id, d.owner_id, d.type_key, d.size, d.sha256, d.created_at,
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

    async eraseObjects(accountId) {
      const keys = await asAccount(accountId, async (tx) =>
        (
          await tx.execute<{ object_key: string }>(sql`
            SELECT object_key FROM vault.document WHERE owner_id = ${accountId}`)
        ).rows.map(({ object_key }) => object_key),
      );
      await storage.delete(keys);
    },

    async expirePending(accountId, now) {
      const cutoff = new Date(now.getTime() - pendingDocumentHours * 3_600_000);
      const expired = await asAccount(
        accountId,
        async (tx) =>
          (
            await tx.execute<{ id: string; object_key: string }>(sql`
            SELECT id, object_key FROM vault.document
             WHERE owner_id = ${accountId} AND confirmed_at IS NULL
               AND created_at <= ${cutoff}`)
          ).rows,
      );
      if (expired.length === 0) return 0;
      await storage.delete(expired.map(({ object_key }) => object_key));
      await asAccount(accountId, (tx) =>
        tx.execute(sql`
          DELETE FROM vault.document
           WHERE owner_id = ${accountId} AND confirmed_at IS NULL
             AND id IN (${sql.join(
               expired.map(({ id }) => sql`${id}`),
               sql`, `,
             )})`),
      );
      return expired.length;
    },
  };
}
