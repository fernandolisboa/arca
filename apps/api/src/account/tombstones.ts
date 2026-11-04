import type { DeploymentEnvironment } from '../config.js';

/**
 * The erasure tombstone (spec 0004, R9, R12): the account ID and the time, written last, so a
 * restore can tell which accounts must stay erased. Writing it twice counts as written.
 */
export interface Tombstones {
  write(accountId: string, at: Date): Promise<void>;
}

export class TombstonesUnavailableError extends Error {
  override name = 'TombstonesUnavailableError';
}

/** Previews, CI and development keep no backups, so nothing needs a tombstone there. */
export const noTombstones: Tombstones = { write: () => Promise.resolve() };

/**
 * Production needs the S3 adapter in the backup account, which comes with that account (spec 0004,
 * R12); until then an erasure stops before its last step, and its run fails, rather than end
 * without a tombstone. Production cannot select the no-op adapter.
 */
export function tombstonesFor(environment: DeploymentEnvironment): Tombstones {
  if (environment === 'production') throw new TombstonesUnavailableError();
  return noTombstones;
}
