import {
  calendarDateSchema,
  maxCasePeople,
  maxPlanMoves,
  maxPlanStages,
  routeIdSchema,
} from '@arca/domain';
import { z } from 'zod';
import { CostTotal, RouteResult } from './case.js';
import type { RouteDefinition } from './index.js';

/*
 * The family plan (ADR-0040): the moves the family intends, each a route for one member with the
 * people it takes along, in stages from who goes first. Every member of the case reads and writes
 * the same plan; each move is evaluated from what the viewer sees, with only the people it takes.
 * Like the rest of the case, it needs a session and a confirmed account (401, 403).
 */

export { maxPlanMoves, maxPlanStages };

const stage = z.int().min(1).max(maxPlanStages);

export const PlannedMove = z.object({
  stage,
  /** The route for the principal, with the unit limited to the people the move takes. */
  result: RouteResult,
  dependents: z
    .array(
      z.object({
        personId: z.uuid(),
        coverage: z.enum(['covered', 'possible', 'not_covered']),
      }),
    )
    .max(maxCasePeople),
});
export type PlannedMove = z.infer<typeof PlannedMove>;

export const FamilyPlan = z.object({
  /** The date versions were selected and facts computed at: today in São Paulo. */
  rulesAsOf: calendarDateSchema,
  moves: z.array(PlannedMove).max(maxPlanMoves),
  /** Members of the case in no move. */
  unplanned: z.array(z.uuid()).max(maxCasePeople),
  /** Every move's total per currency, added in code. */
  totals: z.array(CostTotal).max(50),
});
export type FamilyPlan = z.infer<typeof FamilyPlan>;

export const WriteFamilyPlanRequest = z.strictObject({
  moves: z
    .array(
      z.strictObject({
        stage,
        routeId: routeIdSchema,
        principalId: z.uuid(),
        dependentIds: z.array(z.uuid()).max(maxCasePeople),
      }),
    )
    .max(maxPlanMoves),
});
export type WriteFamilyPlanRequest = z.infer<typeof WriteFamilyPlanRequest>;

const answer = { description: 'The family plan, evaluated', schema: FamilyPlan };

export const getFamilyPlan = {
  method: 'get',
  path: '/case/plan',
  operationId: 'getFamilyPlan',
  summary:
    "The case's family plan, each move evaluated from what the viewer sees with only the people it takes; 60 per hour per session (429 rate_limited); 404 not_found outside a case",
  response: answer,
} as const satisfies RouteDefinition<typeof FamilyPlan>;

export const writeFamilyPlan = {
  method: 'put',
  path: '/case/plan',
  operationId: 'writeFamilyPlan',
  summary:
    "Replaces the case's family plan and answers it evaluated; counts as a case write (429 rate_limited); 404 not_found outside a case; 409 case_invalid for a principal outside the planning, someone outside the case, an unknown route or one route twice for one principal",
  body: WriteFamilyPlanRequest,
  response: answer,
} as const satisfies RouteDefinition<typeof FamilyPlan>;

export const planRoutes = { getFamilyPlan, writeFamilyPlan } as const;
