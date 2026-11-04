import { withIdentity, type Database } from '@arca/db';
import { sql } from 'drizzle-orm';
import { storedMessage, type Notification } from './notification.js';

/** The only producer of notifications (spec 0005, R7). */
export interface Notifier {
  notify(accountId: string, notification: Notification): Promise<void>;
}

/**
 * Records the message under the account's identity, then starts its delivery with identifiers
 * only. `db` is the producer's own pool: app_api for requests, app_jobs for the daily jobs.
 */
export function createNotifier({
  db,
  startDelivery,
}: {
  readonly db: Database;
  readonly startDelivery: (accountId: string, messageId: string) => Promise<unknown>;
}): Notifier {
  return {
    async notify(accountId, notification) {
      const { code, details } = storedMessage(notification);
      const messageId = await withIdentity(db, { accountId }, async (tx) => {
        const result = await tx.execute<{ id: string }>(sql`
          INSERT INTO notification.message (account_id, code, details)
          VALUES (${accountId}, ${code}, ${JSON.stringify(details)}::jsonb)
          RETURNING id`);
        const [row] = result.rows;
        if (row === undefined) throw new Error('message not recorded');
        return row.id;
      });
      await startDelivery(accountId, messageId);
    },
  };
}
