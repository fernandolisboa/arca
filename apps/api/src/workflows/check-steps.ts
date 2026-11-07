import { checkSteps, stepTelemetry } from './step-context.js';
import { withStepError } from './step-error.js';
import type { EntityId, RouteId, VersionNumber } from './workflow-arguments.js';

/**
 * Fetches the version's cited pages, asks the checker, checks its answer and stores the report. A
 * failure leaves no report, so the start dies after 30 minutes and the next screen opening starts
 * the version again; the step itself is never retried, so no check is paid for twice.
 */
export async function runVersionCheck(
  startId: EntityId,
  routeId: RouteId,
  number: VersionNumber,
): Promise<void> {
  'use step';
  await withStepError('check_failed', stepTelemetry, async () =>
    (await checkSteps())(startId, routeId, number),
  );
}
runVersionCheck.maxRetries = 0;
