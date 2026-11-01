import type { HealthResponse } from '@arca/api-contract/routes';

export type DatabaseStatus = HealthResponse['checks']['database'];

/** Port for the database check; the adapter that queries Postgres arrives with the database slice. */
export type CheckDatabase = () => Promise<DatabaseStatus>;

/**
 * Caches the database result per instance, so repeated health calls do not each open a
 * connection (spec 0001, R3). Concurrent callers share one pending check.
 */
export function cachedDatabaseCheck(
  check: CheckDatabase,
  { ttlMs, now }: { ttlMs: number; now: () => number },
): CheckDatabase {
  let cached: { at: number; result: Promise<DatabaseStatus> } | undefined;
  return () => {
    const at = now();
    if (cached === undefined || at - cached.at >= ttlMs) {
      cached = { at, result: check().catch((): DatabaseStatus => 'unavailable') };
    }
    return cached.result;
  };
}
