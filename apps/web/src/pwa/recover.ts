/** Long enough to cover the reload that follows a recovery, short enough for a later deploy. */
export const recoveryWindowMs = 30_000;

/**
 * Each way the page recovers has its own record, so one recovery never blocks the other: a chunk
 * reload can land on an entry script that needs its own.
 */
export type Recovery = 'entry' | 'chunk';

/**
 * Runs `recover` unless this recovery already ran in this tab within the recovery window, so a
 * failure a fresh load does not fix shows as an error instead of a reload loop. Without session
 * storage it never runs.
 */
export function recoverOnce(
  recovery: Recovery,
  storage: () => Storage,
  now: number,
  recover: () => void,
): boolean {
  const key = `arca.recoveredAt.${recovery}`;
  try {
    const store = storage();
    if (now - Number(store.getItem(key)) < recoveryWindowMs) return false;
    store.setItem(key, String(now));
  } catch {
    return false;
  }
  recover();
  return true;
}
