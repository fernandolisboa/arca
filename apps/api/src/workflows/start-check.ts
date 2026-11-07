import { checkVersion } from './check-version.js';
import { startWorkflow } from './start-workflow.js';
import { entityId, routeId, versionNumber } from './workflow-arguments.js';

/** Starts the check of a recorded start, with its identifiers only (ADR-0027). */
export const startCheck = async (start: {
  readonly id: string;
  readonly routeId: string;
  readonly number: number;
}): Promise<void> => {
  await startWorkflow(checkVersion, [
    entityId(start.id),
    routeId(start.routeId),
    versionNumber(start.number),
  ]);
};
