import { runUpdateStep } from './update-steps.js';
import type { EntityId } from './workflow-arguments.js';

/** The four stages and the end, the most steps a request takes (ADR-0031). */
const maxSteps = 5;

/**
 * An update request for one route (ADR-0031): one step per stage, each with no retries, given the
 * request's identifier only; the controller in the step decides what runs next.
 */
export async function updateRoute(requestId: EntityId): Promise<void> {
  'use workflow';
  for (let step = 0; step < maxSteps; step += 1) {
    if (!(await runUpdateStep(requestId))) return;
  }
}
