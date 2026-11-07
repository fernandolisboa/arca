import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './database.js';

/** Who a request acts for. Row-level security policies read these settings (spec 0001, R7). */
export interface RequestIdentity {
  readonly accountId: string;
  readonly caseId?: string;
}

export class InvalidIdentityError extends Error {
  override name = 'InvalidIdentityError';
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(field: string, value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new InvalidIdentityError(`${field} is not a UUID`);
  }
  return value;
}

/**
 * Runs `work` in a transaction whose `app.account_id` and `app.case_id` settings are the request's
 * identity. The IDs are validated before any SQL runs and sent as bind parameters; `set_config`
 * with `is_local` true clears them at the end of the transaction, so they never reach the next
 * transaction on a pooled connection. A missing case is an empty setting, which policies read as
 * null through `nullif(…, '')`.
 */
export async function withIdentity<T>(
  db: Database,
  identity: RequestIdentity,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const accountId = requireUuid('accountId', identity.accountId);
  const caseId = identity.caseId === undefined ? '' : requireUuid('caseId', identity.caseId);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_catalog.set_config('app.account_id', ${accountId}, true), pg_catalog.set_config('app.case_id', ${caseId}, true)`,
    );
    const result = await work(tx);
    // If work swallowed a database error, the transaction is aborted and COMMIT would quietly
    // roll back; this statement fails instead, so the caller sees the error.
    await tx.execute(sql`SELECT 1`);
    return result;
  });
}
