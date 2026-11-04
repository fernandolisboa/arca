import {
  erasable,
  eraseAuthRows,
  eraseOwnedEntries,
  recordErased,
  sendCompletionNotice,
  writeTombstone,
} from './erasure-steps.js';
import type { EntityId } from './workflow-arguments.js';

/**
 * Erases an account whose deletion is due (spec 0004, R9), in the order the spec fixes. Every step
 * is idempotent, so a retried step or a second run changes nothing more; stored objects join with
 * spec 0005.
 */
export async function eraseAccount(accountId: EntityId): Promise<void> {
  'use workflow';
  if (!(await erasable(accountId))) return;
  await eraseOwnedEntries(accountId);
  await sendCompletionNotice(accountId);
  await eraseAuthRows(accountId);
  await recordErased(accountId);
  await writeTombstone(accountId);
}
