import type { Erasure } from '../account/erasure.js';
import type { EntityId } from './workflow-arguments.js';
import { withStepError, type StepErrorCode } from './step-error.js';
import { erasureSteps, stepTelemetry } from './step-context.js';

const run = (code: StepErrorCode, accountId: EntityId, step: keyof Erasure) =>
  withStepError(code, stepTelemetry, async () => (await erasureSteps())[step](accountId));

export async function erasable(accountId: EntityId): Promise<boolean> {
  'use step';
  return (await run('database_unavailable', accountId, 'erasable')) === true;
}

export async function eraseOwnedEntries(accountId: EntityId): Promise<void> {
  'use step';
  await run('database_unavailable', accountId, 'eraseOwnedEntries');
}

export async function sendCompletionNotice(accountId: EntityId): Promise<void> {
  'use step';
  await run('email_unavailable', accountId, 'sendCompletionNotice');
}

export async function eraseAuthRows(accountId: EntityId): Promise<void> {
  'use step';
  await run('database_unavailable', accountId, 'eraseAuthRows');
}

export async function recordErased(accountId: EntityId): Promise<void> {
  'use step';
  await run('database_unavailable', accountId, 'recordErased');
}
