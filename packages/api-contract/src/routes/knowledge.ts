import {
  calendarDateSchema,
  durationStageSchema,
  leapDayBirthdaySchema,
  routeIdSchema,
  ruleCaseSummarySchema,
  sourceSchema,
  viewSections,
} from '@arca/domain';
import { z } from 'zod';
import type { RouteDefinition } from './index.js';

/*
 * Activating and rejecting a route version (spec 0007, R7; ADR-0022). Only an approver may decide
 * (403 not_approver), after a knowledge_decision step-up bound to the action, the route ID and the
 * version number as targets, and the version's content hash as the field contentHash (403
 * step_up_required). The API takes the hash from the catalog it bundles. 404 not_found for a
 * version the catalog does not hold, 409 already_rejected for one already rejected.
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
    'Activates a route version after a knowledge_decision step-up; it counts once its stored assertion verifies. 403 not_approver, 403 step_up_required, 404 not_found, 409 already_rejected',
  body: DecideVersionRequest,
  response: { description: 'Activated', schema: DecideVersionResponse },
} as const satisfies RouteDefinition<typeof DecideVersionResponse>;

export const rejectVersion = {
  method: 'post',
  path: '/knowledge/versions/reject',
  operationId: 'rejectVersion',
  summary:
    'Rejects a route version after a knowledge_decision step-up, at once and for good. 403 not_approver, 403 step_up_required, 404 not_found, 409 already_rejected',
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

const decisionState = z.enum(['active', 'rejected', 'proposed']);
// A country set is named `<id>/<number>` in the changes; a setting by its field name.
const ids = z.array(z.string().max(96)).max(50);

export const KnowledgeVersion = z.object({
  routeId: routeIdSchema,
  number: z.int().min(1),
  title: z.string().max(200),
  country: z.string().regex(/^[A-Z]{2}$/),
  effectiveFrom: calendarDateSchema,
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  state: decisionState,
});
export type KnowledgeVersion = z.infer<typeof KnowledgeVersion>;

export const KnowledgeVersions = z.object({ versions: z.array(KnowledgeVersion) });
export type KnowledgeVersions = z.infer<typeof KnowledgeVersions>;

export const listKnowledgeVersions = {
  method: 'get',
  path: '/knowledge/versions',
  operationId: 'listKnowledgeVersions',
  summary:
    'Every route version the API bundles with its decision state, the newest first, for an approver; 403 not_approver',
  response: { description: 'The versions', schema: KnowledgeVersions },
} as const satisfies RouteDefinition<typeof KnowledgeVersions>;

/** An expression tree with each fact node naming its catalog key and target; display only. */
const expressionView = z.record(z.string(), z.unknown());
const factName = z.object({
  reference: z.string().max(80),
  key: z.string().max(80).nullable(),
  target: z.string().max(20).nullable(),
});
const facts = z.array(factName).max(200);
const sourceIds = z.array(z.string().max(64)).max(20);
const sectionChange = z.object({ added: ids, removed: ids, changed: ids });
const pin = z.object({ id: z.string().max(64), number: z.int().min(1) });

/** One version laid out for the approver (spec 0007, R7), built by `versionView` in the domain. */
export const VersionView = z.object({
  routeId: routeIdSchema,
  number: z.int().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  state: decisionState,
  title: z.string().max(200),
  country: z.string().regex(/^[A-Z]{2}$/),
  tags: z.array(z.string().max(40)).max(20),
  effectiveFrom: calendarDateSchema,
  corrects: z.int().min(1).nullable(),
  status: z.enum(['open', 'closed']),
  currency: z.string().regex(/^[A-Z]{3}$/),
  leapDayBirthday: leapDayBirthdaySchema.nullable(),
  leapDayBirthdaySources: sourceIds,
  referenceDates: z.array(z.string().max(32)).max(10),
  closureSources: sourceIds,
  pins: z.object({ countries: pin, formerCountries: pin, officialDomains: z.array(pin).max(10) }),
  requirements: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        expression: expressionView,
        facts,
        sources: sourceIds,
      }),
    )
    .max(50),
  assessments: z
    .array(z.object({ id: z.string(), title: z.string(), evidence: facts, sources: sourceIds }))
    .max(20),
  dependents: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        path: z.array(z.string()).max(3),
        condition: expressionView,
        facts,
        at: z.string().nullable(),
        sources: sourceIds,
      }),
    )
    .max(20),
  costs: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        kind: z.string(),
        appliesTo: z.string(),
        amount: expressionView,
        condition: expressionView.nullable(),
        facts,
        sources: sourceIds,
      }),
    )
    .max(50),
  durations: z.array(durationStageSchema).max(20),
  countrySets: z
    .array(
      z.object({
        id: z.string(),
        number: z.int().min(1),
        title: z.string(),
        members: z.array(z.string()).max(300),
      }),
    )
    .max(20),
  sources: z
    .array(sourceSchema.extend({ host: z.string().max(253).nullable(), newHost: z.boolean() }))
    .max(50),
  replaces: z
    .object({
      number: z.int().min(1),
      changes: z.object(
        Object.fromEntries(viewSections.map((section) => [section, sectionChange])) as Record<
          (typeof viewSections)[number],
          typeof sectionChange
        >,
      ),
    })
    .nullable(),
  cases: z.array(ruleCaseSummarySchema).max(500),
  rejection: z.object({
    selected: z.boolean(),
    fallback: z.object({ number: z.int().min(1), state: decisionState }).nullable(),
  }),
});
export type VersionView = z.infer<typeof VersionView>;

export const VersionViewQuery = z.object({
  routeId: routeIdSchema,
  number: z.coerce.number<number>().int().min(1).max(1_000_000),
});
export type VersionViewQuery = z.infer<typeof VersionViewQuery>;

export const getVersionView = {
  method: 'get',
  path: '/knowledge/versions/view',
  operationId: 'getVersionView',
  summary:
    "One route version laid out for an approver, from its content alone, with what changed, its sources, its cases and what rejecting it would do to today's selection; 403 not_approver, 404 not_found",
  query: VersionViewQuery,
  response: { description: 'The version', schema: VersionView },
} as const satisfies RouteDefinition<typeof VersionView>;

export const knowledgeRoutes = {
  activateVersion,
  rejectVersion,
  listKnowledgeVersions,
  getVersionView,
} as const;

export {
  type FactKey,
  collectionNames,
  comparisonOperators,
  expressionOperators,
  factKeys,
  factTargets,
  relationshipSteps,
  staleAfterDays,
} from '@arca/domain';
