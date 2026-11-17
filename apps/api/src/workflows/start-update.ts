import { startWorkflow } from './start-workflow.js';
import { updateRoute } from './update-route.js';
import { entityId } from './workflow-arguments.js';

/** Starts the run of a stored update request, with its identifier only (ADR-0031). */
export const startUpdate = async (requestId: string): Promise<void> => {
  await startWorkflow(updateRoute, [entityId(requestId)]);
};
