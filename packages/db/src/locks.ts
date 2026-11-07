import { sql } from 'drizzle-orm';
import type { Transaction } from './database.js';

/**
 * Takes a transaction-scoped advisory lock on a text key, such as `cases.case_file:<id>`, held
 * until the transaction ends, so the work it guards runs one at a time per key.
 */
export async function lockKey(tx: Transaction, key: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${key}, 0))`,
  );
}
