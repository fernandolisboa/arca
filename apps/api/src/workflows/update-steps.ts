import { stepTelemetry, updateSteps } from './step-context.js';
import { withStepError } from './step-error.js';
import type { EntityId } from './workflow-arguments.js';

/**
 * Runs the request's next stage, or ends it, and answers whether more remain. A stage that fails
 * stores its failure and ends the request; the step is never retried, so no model call is paid
 * for twice, and a request a crash left with no end shows as stalled after an hour.
 */
export async function runUpdateStep(requestId: EntityId): Promise<boolean> {
  'use step';
  return withStepError('update_failed', stepTelemetry, async () =>
    (await updateSteps())(requestId),
  );
}
runUpdateStep.maxRetries = 0;
