import { sql } from 'drizzle-orm';
import type { Database } from './database.js';

/**
 * Reads the server's clock in a read-only transaction: the heartbeat workflow's step (spec 0001,
 * R6). The driver returns timestamps as text, so the server formats it as ISO 8601 in UTC.
 */
export async function readServerTime(db: Database): Promise<Date> {
  return db.transaction(
    async (tx) => {
      const result = await tx.execute<{ now: unknown }>(
        sql`SELECT pg_catalog.to_char(pg_catalog.now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now`,
      );
      const now = new Date(String(result.rows[0]?.now));
      if (Number.isNaN(now.getTime())) throw new TypeError('now() did not return a timestamp');
      return now;
    },
    { accessMode: 'read only' },
  );
}
