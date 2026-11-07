import {
  calendarDateSchema,
  comparisonCriterionSchema,
  countryCodeSchema,
  durationStageSchema,
  leapDayBirthdaySchema,
  routeIdSchema,
  ruleCaseSummarySchema,
  slugSchema,
  sourceSchema,
  viewSections,
} from '@arca/domain';
import { z } from 'zod';
import { ruleReportReasons } from './case.js';
import type { RouteDefinition } from './index.js';

/*
 * Activating and rejecting a route version (spec 0007, R7; ADR-0027). Only an admin may decide
 * (403 not_admin), signed in, with no step-up; the body names the version and nothing else, and
 * the API takes its hash from the catalog it bundles. 404 not_found for a version the catalog does
 * not hold, 409 already_rejected for one already rejected.
 *
 * Decisions stored before ADR-0027 were approved by a knowledge_decision step-up bound to the
 * action, the route ID and the version number as targets, and the content hash as the field
 * contentHash; `decideVersionAction` rebuilds that action so they verify again (ADR-0022).
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
    'Activates a route version for a signed-in admin, with no step-up. 403 not_admin, 404 not_found, 409 already_rejected',
  body: DecideVersionRequest,
  response: { description: 'Activated', schema: DecideVersionResponse },
} as const satisfies RouteDefinition<typeof DecideVersionResponse>;

export const rejectVersion = {
  method: 'post',
  path: '/knowledge/versions/reject',
  operationId: 'rejectVersion',
  summary:
    'Rejects a route version for a signed-in admin, with no step-up, at once and for good. 403 not_admin, 404 not_found, 409 already_rejected',
  body: DecideVersionRequest,
  response: { description: 'Rejected', schema: DecideVersionResponse },
} as const satisfies RouteDefinition<typeof DecideVersionResponse>;

/** The step-up action of an ADR-0022 decision: the route and number as targets, the hash a field. */
export function decideVersionAction(
  decision: 'activateVersion' | 'rejectVersion',
  { routeId, number }: DecideVersionRequest,
  contentHash: string,
) {
  return { action: decision, targets: [routeId, String(number)], fields: { contentHash } };
}

const contentHash = z.string().regex(/^[0-9a-f]{64}$/);

/*
 * Activating and rejecting a comparison version (ADR-0026, ADR-0027), as for a route version. The
 * API takes the content hash over the version and every indicator it pins from the catalog it
 * bundles. Decisions stored before ADR-0027 used their own step-up actions, so an approval of one
 * kind never verifies as the other.
 */

export const DecideComparisonRequest = z.strictObject({
  comparisonId: slugSchema,
  number: z.int().min(1).max(1_000_000),
});
export type DecideComparisonRequest = z.infer<typeof DecideComparisonRequest>;

export const activateComparison = {
  method: 'post',
  path: '/knowledge/comparisons/activate',
  operationId: 'activateComparison',
  summary:
    'Activates a comparison version for a signed-in admin, with no step-up. 403 not_admin, 404 not_found, 409 already_rejected',
  body: DecideComparisonRequest,
  response: { description: 'Activated', schema: DecideVersionResponse },
} as const satisfies RouteDefinition<typeof DecideVersionResponse>;

export const rejectComparison = {
  method: 'post',
  path: '/knowledge/comparisons/reject',
  operationId: 'rejectComparison',
  summary:
    'Rejects a comparison version for a signed-in admin, with no step-up, at once and for good; the newest active version before it stays in use. 403 not_admin, 404 not_found, 409 already_rejected',
  body: DecideComparisonRequest,
  response: { description: 'Rejected', schema: DecideVersionResponse },
} as const satisfies RouteDefinition<typeof DecideVersionResponse>;

/** The step-up action of an ADR-0022 comparison decision: ID and number targets, the hash a field. */
export function decideComparisonAction(
  decision: 'activateComparison' | 'rejectComparison',
  { comparisonId, number }: DecideComparisonRequest,
  contentHash: string,
) {
  return { action: decision, targets: [comparisonId, String(number)], fields: { contentHash } };
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
  hash: contentHash,
  state: decisionState,
});
export type KnowledgeVersion = z.infer<typeof KnowledgeVersion>;

export const KnowledgeComparisonVersion = z.object({
  comparisonId: slugSchema,
  number: z.int().min(1),
  title: z.string().max(200),
  hash: contentHash,
  state: decisionState,
});
export type KnowledgeComparisonVersion = z.infer<typeof KnowledgeComparisonVersion>;

export const KnowledgeVersions = z.object({
  versions: z.array(KnowledgeVersion),
  /** The destination comparison's versions, the newest first (ADR-0026). */
  comparisons: z.array(KnowledgeComparisonVersion).max(100),
});
export type KnowledgeVersions = z.infer<typeof KnowledgeVersions>;

export const listKnowledgeVersions = {
  method: 'get',
  path: '/knowledge/versions',
  operationId: 'listKnowledgeVersions',
  summary:
    'Every route and comparison version the API bundles with its decision state, the newest first, for an admin; 403 not_admin',
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

/** One version laid out for an admin (spec 0007, R7), built by `versionView` in the domain. */
export const VersionView = z.object({
  routeId: routeIdSchema,
  number: z.int().min(1),
  hash: contentHash,
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
    "One route version laid out for an admin, from its content alone, with what changed, its sources, its cases and what rejecting it would do to today's selection; 403 not_admin, 404 not_found",
  query: VersionViewQuery,
  response: { description: 'The version', schema: VersionView },
} as const satisfies RouteDefinition<typeof VersionView>;

const year = z.int().min(1900).max(2200);

/** One comparison version laid out for an admin (ADR-0026), built by the domain. */
export const ComparisonVersionView = z.object({
  comparisonId: slugSchema,
  number: z.int().min(1),
  hash: contentHash,
  state: decisionState,
  title: z.string().max(200),
  criteria: z.array(comparisonCriterionSchema).max(50),
  indicators: z
    .array(
      z.object({
        id: slugSchema,
        number: z.int().min(1),
        title: z.string().max(200),
        unit: z.string().max(200),
        valueType: z.enum(['decimal', 'token']),
        sources: z.array(sourceSchema.extend({ host: z.string().max(253).nullable() })).max(20),
        values: z
          .array(
            z.object({
              country: countryCodeSchema,
              value: z.string().max(40),
              year,
              source: slugSchema,
              host: z.string().max(253).nullable(),
              previous: z.object({ value: z.string().max(40), year }).nullable(),
            }),
          )
          .max(300),
        removed: z.array(countryCodeSchema).max(300),
      }),
    )
    .max(20),
  replaces: z
    .object({ number: z.int().min(1), criteria: sectionChange, indicators: sectionChange })
    .nullable(),
  rejection: z.object({
    selected: z.boolean(),
    fallback: z.object({ number: z.int().min(1) }).nullable(),
  }),
});
export type ComparisonVersionView = z.infer<typeof ComparisonVersionView>;

export const ComparisonViewQuery = z.object({
  comparisonId: slugSchema,
  number: z.coerce.number<number>().int().min(1).max(1_000_000),
});
export type ComparisonViewQuery = z.infer<typeof ComparisonViewQuery>;

export const getComparisonView = {
  method: 'get',
  path: '/knowledge/comparisons/view',
  operationId: 'getComparisonView',
  summary:
    'One comparison version laid out for an admin: its criteria, every indicator value with its year and source host beside the value it replaces, what changed and what rejecting it would do; 403 not_admin, 404 not_found',
  query: ComparisonViewQuery,
  response: { description: 'The comparison version', schema: ComparisonVersionView },
} as const satisfies RouteDefinition<typeof ComparisonVersionView>;

/**
 * A model's reading of one version for an admin (ADR-0025): an aid to review, never a decision.
 * Plain text only; the screen renders it as text, so no link or image in it is ever followed.
 */
export const RuleSummary = z.strictObject({
  overview: z.string().trim().min(1).max(1_500),
  watchPoints: z.array(z.string().trim().min(1).max(600)).max(8),
});
export type RuleSummary = z.infer<typeof RuleSummary>;

export const summarizeVersion = {
  method: 'post',
  path: '/knowledge/versions/summary',
  operationId: 'summarizeVersion',
  summary:
    "Sends one version's content (public rule data, no case data) to a model and answers a short summary with points to check, for an admin; the summary is stored, so the same content, prompt and model answer it again without a model call. 30 per account per day and 5 per minute (429 rate_limited); 403 not_admin; 404 not_found; 502 summary_unparsable or summary_failed; 503 summary_unavailable when no model can be reached; 504 summary_timeout",
  body: DecideVersionRequest,
  response: { description: 'The summary', schema: RuleSummary },
} as const satisfies RouteDefinition<typeof RuleSummary>;

export const StoredRuleSummary = z.strictObject({ summary: RuleSummary.nullable() });
export type StoredRuleSummary = z.infer<typeof StoredRuleSummary>;

export const getVersionSummary = {
  method: 'get',
  path: '/knowledge/versions/summary',
  operationId: 'getVersionSummary',
  summary:
    "The summary already stored for one version under today's prompt and model, or null when none was asked for yet; never calls a model. 403 not_admin; 404 not_found",
  query: VersionViewQuery,
  response: { description: 'The stored summary, or null', schema: StoredRuleSummary },
} as const satisfies RouteDefinition<typeof StoredRuleSummary>;

const ruleReference = {
  routeId: routeIdSchema,
  versionNumber: z.int().min(1).max(1_000_000),
  requirementId: slugSchema,
};

/** Open reports counted per requirement and reason, with no note, case or reporter (R8). */
export const RuleReports = z.object({
  reports: z.array(
    z.object({
      ...ruleReference,
      reason: z.enum(ruleReportReasons),
      count: z.int().min(1),
    }),
  ),
});
export type RuleReports = z.infer<typeof RuleReports>;

export const listRuleReports = {
  method: 'get',
  path: '/knowledge/reports',
  operationId: 'listRuleReports',
  summary:
    'The open reports of possibly wrong requirements, counted per requirement and reason, for an admin; 403 not_admin',
  response: { description: 'The open reports', schema: RuleReports },
} as const satisfies RouteDefinition<typeof RuleReports>;

export const CloseRuleReportsRequest = z.strictObject(ruleReference);
export type CloseRuleReportsRequest = z.infer<typeof CloseRuleReportsRequest>;

export const CloseRuleReportsResponse = z.object({ closed: z.int().min(0) });

export const closeRuleReports = {
  method: 'post',
  path: '/knowledge/reports/close',
  operationId: 'closeRuleReports',
  summary:
    'Closes the open reports of one requirement of a version once it is researched, for an admin; answers how many it closed; 403 not_admin',
  body: CloseRuleReportsRequest,
  response: { description: 'Closed', schema: CloseRuleReportsResponse },
} as const satisfies RouteDefinition<typeof CloseRuleReportsResponse>;

export const knowledgeRoutes = {
  activateVersion,
  rejectVersion,
  activateComparison,
  rejectComparison,
  listKnowledgeVersions,
  getVersionView,
  getComparisonView,
  getVersionSummary,
  summarizeVersion,
  listRuleReports,
  closeRuleReports,
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
