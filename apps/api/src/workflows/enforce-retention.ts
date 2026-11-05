import {
  expireOwnedRows,
  expirePendingDocuments,
  markUnconfirmedAccounts,
  sweepExpiredRows,
  warnInactiveAccounts,
} from './retention-steps.js';
import type { IsoDate } from './workflow-arguments.js';

/**
 * The daily retention rules of RETENTION.md (spec 0004, R10). Every step is idempotent; accounts
 * it marks for erasure are erased by the daily `eraseAccount` runs. `runDate` only tells runs
 * apart.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the date only labels the run
export async function enforceRetention(runDate: IsoDate): Promise<void> {
  'use workflow';
  await sweepExpiredRows();
  await expireOwnedRows();
  await expirePendingDocuments();
  await markUnconfirmedAccounts();
  await warnInactiveAccounts();
}
