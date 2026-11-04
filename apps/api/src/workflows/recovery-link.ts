import { issueRecoveryLink } from './issue-recovery-link.js';
import type { EntityId } from './workflow-arguments.js';

/**
 * Sends an account's recovery link behind the start's answer (spec 0003, R6), so the answer never
 * waits for an email send. The run receives the account ID only; the step reads the address and
 * makes the token itself.
 */
export async function recoveryLink(accountId: EntityId): Promise<void> {
  'use workflow';
  await issueRecoveryLink(accountId);
}
