import type { Retention } from '../account/retention.js';
import { withStepError, type StepErrorCode } from './step-error.js';
import { retentionSteps, stepTelemetry } from './step-context.js';

// Each step counts from its own clock, read when it runs.
const run = (step: keyof Retention, code: StepErrorCode = 'database_unavailable') =>
  withStepError(code, stepTelemetry, async () => (await retentionSteps())[step](new Date()));

export async function sweepExpiredRows(): Promise<void> {
  'use step';
  await run('sweepExpiredRows');
}

export async function expireOwnedRows(): Promise<void> {
  'use step';
  await run('expireOwnedRows');
}

export async function markUnconfirmedAccounts(): Promise<void> {
  'use step';
  await run('markUnconfirmedAccounts');
}

export async function warnInactiveAccounts(): Promise<void> {
  'use step';
  await run('warnInactiveAccounts', 'email_unavailable');
}
