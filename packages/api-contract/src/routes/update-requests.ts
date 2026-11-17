import {
  maxCheckCostMicroUsd,
  proposalLists,
  routeIdSchema,
  updateFailures,
  updateStages,
} from '@arca/domain';
import { z } from 'zod';
import type { RouteDefinition } from './index.js';

/*
 * Update requests (ADR-0031): an admin asks for one route to be researched again; a workflow runs
 * research, validation, at most one correction and a final validation, and ends with a proposal
 * or a fixed failure code. Nothing starts one but this request.
 */

export const StartUpdateRequest = z.strictObject({ routeId: routeIdSchema });
export type StartUpdateRequest = z.infer<typeof StartUpdateRequest>;

export const StartedUpdateRequest = z.strictObject({ requestId: z.uuid() });
export type StartedUpdateRequest = z.infer<typeof StartedUpdateRequest>;

export const startUpdateRequest = {
  method: 'post',
  path: '/knowledge/update-requests',
  operationId: 'startUpdateRequest',
  summary:
    "Starts, for an admin, an update request for one route's newest version: research, validation, at most one correction and a final validation, then a proposal. 10 per account per hour (429 rate_limited). 403 not_admin; 404 not_found for a route with no version; 409 update_live while a request of the route runs; 502 update_not_started when the run could not begin, which then counts as running for up to an hour; 503 update_off where the AI keys are not set",
  body: StartUpdateRequest,
  response: { description: 'Started', schema: StartedUpdateRequest },
} as const satisfies RouteDefinition<typeof StartedUpdateRequest>;

export const UpdateRequestQuery = z.strictObject({ routeId: routeIdSchema });

/** A stage as the progress shows it. */
export const updateStageStates = ['done', 'failed', 'running', 'pending', 'skipped'] as const;

export const UpdateProgress = z.strictObject({
  requestId: z.uuid(),
  routeId: routeIdSchema,
  baseNumber: z.int().min(1),
  requestedAt: z.iso.datetime(),
  /** `stalled`: no end an hour after it was asked for, so it no longer blocks a new one. */
  state: z.enum(['running', 'finished', 'failed', 'stalled']),
  failure: z.enum(updateFailures).nullable(),
  stages: z.array(
    z.strictObject({ stage: z.enum(updateStages), state: z.enum(updateStageStates) }),
  ),
  /** What the request's model calls and web searches cost, in millionths of a dollar. */
  cost: z
    .discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('priced'),
        microUsd: z.int().min(0).max(maxCheckCostMicroUsd),
      }),
      z.strictObject({ kind: z.literal('unknown') }),
      z.strictObject({ kind: z.literal('scripted') }),
    ])
    .nullable(),
  /** How many items each of the three lists holds, once the request finished. */
  lists: z.record(z.enum(proposalLists), z.int().min(0)).nullable(),
  /** The proposal's content hash, once the request finished. */
  contentHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
});
export type UpdateProgress = z.infer<typeof UpdateProgress>;

export const NewestUpdateRequest = z.strictObject({ request: UpdateProgress.nullable() });
export type NewestUpdateRequest = z.infer<typeof NewestUpdateRequest>;

export const getNewestUpdateRequest = {
  method: 'get',
  path: '/knowledge/update-requests',
  operationId: 'getNewestUpdateRequest',
  summary:
    'The newest update request of a route with its progress by stage and what it cost, or null when it has none; never calls a model. 403 not_admin',
  query: UpdateRequestQuery,
  response: { description: 'The newest request, or null', schema: NewestUpdateRequest },
} as const satisfies RouteDefinition<typeof NewestUpdateRequest>;

export const updateRequestRoutes = { startUpdateRequest, getNewestUpdateRequest } as const;
