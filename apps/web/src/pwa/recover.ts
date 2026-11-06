const recoveredAtKey = 'arca.recoveredAt';
/** Long enough to cover the reload that follows a recovery, short enough for a later deploy. */
export const recoveryWindowMs = 30_000;

/**
 * Runs `recover` unless it already ran in this tab within the last 30 seconds, so a failure a
 * fresh load does not fix shows as an error instead of a reload loop. Without session storage it
 * never runs.
 */
export function recoverOnce(storage: () => Storage, now: number, recover: () => void): boolean {
  try {
    const store = storage();
    if (now - Number(store.getItem(recoveredAtKey)) < recoveryWindowMs) return false;
    store.setItem(recoveredAtKey, String(now));
  } catch {
    return false;
  }
  recover();
  return true;
}
