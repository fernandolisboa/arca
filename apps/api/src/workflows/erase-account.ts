import {
  erasable,
  eraseAuthRows,
  eraseOwnedEntries,
  eraseStoredObjects,
  recordErased,
  sendCompletionNotice,
} from './erasure-steps.js';
import type { EntityId } from './workflow-arguments.js';

/**
 * Erases an account whose deletion is due (spec 0004, R9), in the order the spec fixes. Every step
 * is idempotent, so a retried step or a second run changes nothing more. Stored objects go first,
 * while the document rows still name them (spec 0005, R4).
 */
export async function eraseAccount(accountId: EntityId): Promise<void> {
  'use workflow';
  if (!(await erasable(accountId))) return;
  await eraseStoredObjects(accountId);
  await eraseOwnedEntries(accountId);
  await sendCompletionNotice(accountId);
  await eraseAuthRows(accountId);
  await recordErased(accountId);
}
