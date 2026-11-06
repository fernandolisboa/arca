import { routeIdSchema } from '@arca/domain';
import { z } from 'zod';
import type { RouteDefinition } from './index.js';

/*
 * Activating and rejecting a route version (spec 0007, R7; ADR-0022). Only an approver may decide
 * (403 not_approver), after a knowledge_decision step-up bound to the action, the route ID and the
 * version number as targets, and the version's content hash as the field contentHash (403
 * step_up_required). The API takes the hash from the catalog it bundles. 404 not_found for a
 * version the catalog does not hold, 409 version_rejected for one already rejected.
 */

export const DecideVersionRequest = z.strictObject({
  routeId: routeIdSchema,
  number: z.int().min(1).max(1_000_000),
});
export type DecideVersionRequest = z.infer<typeof DecideVersionRequest>;

export const DecideVersionResponse = z.object({ decisionId: z.uuid() });
export type DecideVersionResponse = z.infer<typeof DecideVersionResponse>;

export const activateVersion = {
  method: 'post',
  path: '/knowledge/versions/activate',
  operationId: 'activateVersion',
  summary:
    'Activates a route version after a knowledge_decision step-up; it counts once its stored assertion verifies. 403 not_approver, 403 step_up_required, 404 not_found, 409 version_rejected',
  body: DecideVersionRequest,
  response: { description: 'Activated', schema: DecideVersionResponse },
} as const satisfies RouteDefinition<typeof DecideVersionResponse>;

export const rejectVersion = {
  method: 'post',
  path: '/knowledge/versions/reject',
  operationId: 'rejectVersion',
  summary:
    'Rejects a route version after a knowledge_decision step-up, at once and for good. 403 not_approver, 403 step_up_required, 404 not_found, 409 version_rejected',
  body: DecideVersionRequest,
  response: { description: 'Rejected', schema: DecideVersionResponse },
} as const satisfies RouteDefinition<typeof DecideVersionResponse>;

/** The step-up action of a decision: the route and the number as targets, the hash as a field. */
export function decideVersionAction(
  decision: 'activateVersion' | 'rejectVersion',
  { routeId, number }: DecideVersionRequest,
  contentHash: string,
) {
  return { action: decision, targets: [routeId, String(number)], fields: { contentHash } };
}

export const knowledgeRoutes = { activateVersion, rejectVersion } as const;
