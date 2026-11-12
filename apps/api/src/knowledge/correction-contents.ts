import { type Database, withIdentity } from '@arca/db';
import { sql } from 'drizzle-orm';
import type { ObjectStorage } from '../storage/object-storage.js';

/** A request's contents go this long after an admin closed it (ADR-0029, RETENTION.md). */
export const closedCorrectionDays = 30;

/** And this long after it was filed, whatever its state. */
export const filedCorrectionDays = 180;

/** An upload no request names goes after this long; filing takes one only within 2 hours. */
export const unusedUploadHours = 24;

/** What the jobs do to correction request contents, on the app_jobs pool under the author. */
export interface CorrectionContents {
  /** Deletes the objects of every upload the account made, before erasure deletes the rows. */
  readonly eraseObjects: (accountId: string) => Promise<void>;
  /**
   * The daily step: erases the note, sources and files of the account's requests that are due,
   * and deletes uploads no request names once a day old; objects first, then rows. Answers how
   * many objects it deleted.
   */
  readonly expire: (accountId: string, now: Date) => Promise<number>;
}

export function createCorrectionContents({
  db,
  storage,
}: {
  readonly db: Database;
  readonly storage: ObjectStorage;
}): CorrectionContents {
  return {
    async eraseObjects(accountId) {
      const pathnames = await withIdentity(db, { accountId }, async (tx) =>
        (
          await tx.execute<{ pathname: string }>(sql`
            SELECT pathname FROM knowledge.correction_upload WHERE author_account_id = ${accountId}`)
        ).rows.map(({ pathname }) => pathname),
      );
      await storage.delete(pathnames);
    },

    async expire(accountId, now) {
      const closedBefore = new Date(now.getTime() - closedCorrectionDays * 86_400_000);
      const filedBefore = new Date(now.getTime() - filedCorrectionDays * 86_400_000);
      const uploadedBefore = new Date(now.getTime() - unusedUploadHours * 3_600_000);
      const due = sql`
        SELECT r.id FROM knowledge.correction_request r
         WHERE r.author_account_id = ${accountId} AND r.content_erased_at IS NULL
           AND (r.created_at <= ${filedBefore}
             OR EXISTS (SELECT FROM knowledge.correction_event e
                         WHERE e.request_id = r.id AND e.kind = 'closed' AND e.at <= ${closedBefore}))`;
      // A due request's uploads started before it was filed, so more than a day ago: once its
      // sources go, every upload to delete is one no source names and older than a day.
      const pathnames = await withIdentity(db, { accountId }, async (tx) =>
        (
          await tx.execute<{ pathname: string }>(sql`
            SELECT u.pathname FROM knowledge.correction_upload u
             WHERE u.author_account_id = ${accountId} AND u.created_at <= ${uploadedBefore}
               AND NOT EXISTS (SELECT FROM knowledge.correction_source s
                                WHERE s.upload_id = u.id AND s.request_id NOT IN (${due}))`)
        ).rows.map(({ pathname }) => pathname),
      );
      await storage.delete(pathnames);
      await withIdentity(db, { accountId }, async (tx) => {
        await tx.execute(sql`
          UPDATE knowledge.correction_request SET note = NULL, content_erased_at = ${now}
           WHERE id IN (${due})`);
        await tx.execute(sql`
          DELETE FROM knowledge.correction_source s
           USING knowledge.correction_request r
           WHERE r.id = s.request_id AND r.author_account_id = ${accountId}
             AND r.content_erased_at IS NOT NULL`);
        await tx.execute(sql`
          DELETE FROM knowledge.correction_upload u
           WHERE u.author_account_id = ${accountId} AND u.created_at <= ${uploadedBefore}
             AND NOT EXISTS (SELECT FROM knowledge.correction_source s WHERE s.upload_id = u.id)`);
      });
      return pathnames.length;
    },
  };
}
