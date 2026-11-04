import { authParts, logger } from '../services.js';
import { withStepError } from './step-error.js';
import type { EntityId } from './workflow-arguments.js';

export async function issueRecoveryLink(accountId: EntityId): Promise<void> {
  'use step';
  await withStepError('recovery_link_unsent', logger, async () => {
    await (await authParts()).recovery.issueLink(accountId);
  });
}
