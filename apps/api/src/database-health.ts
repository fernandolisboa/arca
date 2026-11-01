import type { HealthResponse } from '@arca/api-contract/routes';

export type DatabaseStatus = HealthResponse['checks']['database'];

export type CheckDatabase = () => Promise<DatabaseStatus>;

/**
 * Caches the database result per instance, so repeated health calls do not each open a
 * connection (spec 0001, R3). Concurrent callers share one pending check. A check that throws,
 * rejects or outlasts `timeoutMs` counts as `unavailable`.
 */
export function cachedDatabaseCheck(
  check: CheckDatabase,
  { ttlMs, timeoutMs, now }: { ttlMs: number; timeoutMs: number; now: () => number },
): CheckDatabase {
  let cached: { at: number; result: Promise<DatabaseStatus> } | undefined;
  return () => {
    const at = now();
    if (cached === undefined || at - cached.at >= ttlMs) {
      cached = { at, result: withTimeout(check, timeoutMs) };
    }
    return cached.result;
  };
}

async function withTimeout(check: CheckDatabase, timeoutMs: number): Promise<DatabaseStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DatabaseStatus>((resolve) => {
    timer = setTimeout(() => {
      resolve('unavailable');
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(check), timeout]);
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}
