import {
  calendarDateSchema,
  comparisonCriterionSchema,
  correctionItemKinds,
  correctionStates,
  keyedCorrectionItemKinds,
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
import {
  ObjectUpload,
  ObjectUploadUrlRequest,
  ObjectUploadUrlResponse,
  Sha256,
} from './uploads.js';

/*
 * Activating and rejecting a route version (spec 0007, R7; ADR-0031). Only an admin may decide
 * (403 not_admin), after a knowledge_decision step-up (403 step_up_required) bound to the action,
 * the route ID and the version number as targets, and the content hash and the cases hash as the
 * fields contentHash and casesHash, as the admin saw them; the body names the version and nothing
 * else, and the API takes both hashes from the rules it read, so an approval of anything else
 * never matches. 404 not_found for a version the rules do not hold, 409 already_rejected for one
 * already rejected.
 *
 * Decisions stored before ADR-0027 were approved by the same step-up with the content hash alone;
 * `decideVersionAction` without a cases hash rebuilds that action so they verify again (ADR-0022).
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
    'Activates a route version for an admin after a knowledge_decision step-up bound to its hashes. 403 not_admin, 403 step_up_required, 404 not_found, 409 already_rejected, 409 list_pending while it pins a first official-domain list that is not active',
  body: DecideVersionRequest,
  response: { description: 'Activated', schema: DecideVersionResponse },
} as const satisfies RouteDefinition<typeof DecideVersionResponse>;

export const rejectVersion = {
  method: 'post',
  path: '/knowledge/versions/reject',
  operationId: 'rejectVersion',
  summary:
    'Rejects a route version for an admin after a knowledge_decision step-up bound to its hashes, at once and for good. 403 not_admin, 403 step_up_required, 404 not_found, 409 already_rejected',
  body: DecideVersionRequest,
  response: { description: 'Rejected', schema: DecideVersionResponse },
} as const satisfies RouteDefinition<typeof DecideVersionResponse>;

/**
 * The step-up action of a route decision: the route and number as targets, the hashes as fields.
 * An ADR-0022 decision bound the content hash alone, so it has no cases hash.
 */
export function decideVersionAction(
  decision: 'activateVersion' | 'rejectVersion',
  { routeId, number }: DecideVersionRequest,
  contentHash: string,
  casesHash?: string,
) {
  return {
    action: decision,
    targets: [routeId, String(number)],
    fields: casesHash === undefined ? { contentHash } : { contentHash, casesHash },
  };
}

const contentHash = z.string().regex(/^[0-9a-f]{64}$/);

/*
 * Activating and rejecting a comparison version (ADR-0026, ADR-0031), as for a route version, with
 * the content hash alone. The API takes the content hash over the version and every indicator it
 * pins from the catalog it bundles. Each subject kind has its own step-up actions, so an approval
 * of one kind never verifies as the other.
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
    'Activates a comparison version for an admin after a knowledge_decision step-up bound to its hash. 403 not_admin, 403 step_up_required, 404 not_found, 409 already_rejected',
  body: DecideComparisonRequest,
  response: { description: 'Activated', schema: DecideVersionResponse },
} as const satisfies RouteDefinition<typeof DecideVersionResponse>;

export const rejectComparison = {
  method: 'post',
  path: '/knowledge/comparisons/reject',
  operationId: 'rejectComparison',
  summary:
    'Rejects a comparison version for an admin after a knowledge_decision step-up bound to its hash, at once and for good; the newest active version before it stays in use. 403 not_admin, 403 step_up_required, 404 not_found, 409 already_rejected',
  body: DecideComparisonRequest,
  response: { description: 'Rejected', schema: DecideVersionResponse },
} as const satisfies RouteDefinition<typeof DecideVersionResponse>;

/** The step-up action of a comparison decision: ID and number targets, the hash a field. */
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
  /**
   * No date from today on selects this version: a correction or a later version replaced it, or it
   * was rejected. Recomputed on each read, so it clears if the replacing version is rejected. A
   * proposed one needs no decision while it holds.
   */
  superseded: z.boolean(),
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
  /** The hash of the version's cases as stored, which a decision binds with `hash` (ADR-0031). */
  casesHash: contentHash,
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
    .array(
      sourceSchema.extend({
        host: z.string().max(253).nullable(),
        newHost: z.boolean(),
        newMachineReadableHost: z.boolean(),
      }),
    )
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

/*
 * Correction requests (ADR-0029). An owner-list admin points at a wrong item of a route version,
 * says what is wrong and adds up to five sources as leads; any admin reads a version's requests
 * and closes one. 403 not_admin for anyone else; 403 owner_list_only when an admin by grant files.
 */

/** The limits of a request (ADR-0029), checked here and again by the database. */
export const correctionLimits = {
  note: 4_000,
  sources: 5,
  /** A request for a new route carries its pages and their passages, so it takes more. */
  routeSources: 20,
  text: 20_000,
  url: 2_048,
  fileBytes: 16 * 1024 * 1024,
} as const;

/** The media types a request's file may have, checked again by content when the request is filed. */
export const correctionFileTypes = ['application/pdf', 'text/html', 'text/plain'] as const;
export type CorrectionFileType = (typeof correctionFileTypes)[number];

/** The item a request points at: the whole version, its settings, or one item by its key. */
export const CorrectionItem = z
  .strictObject({
    kind: z.enum(correctionItemKinds),
    key: z
      .string()
      .regex(/^[a-z0-9][a-z0-9./-]{0,79}$/)
      .nullable(),
  })
  .refine(({ kind, key }) => keyedCorrectionItemKinds.includes(kind) === (key !== null), {
    message: 'An item kind that names one item carries its key; the others carry none',
  });
export type CorrectionItem = z.infer<typeof CorrectionItem>;

/** An `https` address a request names, checked here and again by the database. */
export const requestUrl = z
  .url({ protocol: /^https$/, hostname: z.regexes.domain })
  .max(correctionLimits.url)
  .regex(/^https:\/\/\S+$/);
const LinkSource = z.strictObject({ kind: z.literal('link'), url: requestUrl });
/**
 * The official page a file is a copy of, one the version cites, or null. The retired independent
 * check read the newest such copy when it could not read the page itself (ADR-0031).
 */
const pageUrl = requestUrl.nullable();
const TextSource = z.strictObject({
  kind: z.literal('text'),
  text: z.string().trim().min(1).max(correctionLimits.text),
  /** The page the text was copied from, if the admin named one. */
  url: requestUrl.optional(),
});

/**
 * A source as filed: a link, pasted text, or a file uploaded first, named by its upload, with the
 * cited page it copies, if any.
 */
export const CorrectionSource = z.discriminatedUnion('kind', [
  LinkSource,
  TextSource,
  z.strictObject({ kind: z.literal('file'), uploadId: z.uuid(), pageUrl: pageUrl.default(null) }),
]);
export type CorrectionSource = z.infer<typeof CorrectionSource>;

/** A source as listed: a file shows its type and size, and opens through `correctionFileUrl`. */
export const ListedCorrectionSource = z.discriminatedUnion('kind', [
  LinkSource,
  TextSource,
  z.object({
    kind: z.literal('file'),
    mediaType: z.enum(correctionFileTypes),
    size: z.int().min(1).max(correctionLimits.fileBytes),
    pageUrl,
  }),
]);
export type ListedCorrectionSource = z.infer<typeof ListedCorrectionSource>;

const namesEachUploadOnce = ({ sources }: { sources: readonly CorrectionSource[] }) => {
  const uploads = sources.flatMap((source) => (source.kind === 'file' ? [source.uploadId] : []));
  return new Set(uploads).size === uploads.length;
};

export const FileCorrectionRequest = z
  .strictObject({
    routeId: routeIdSchema,
    versionNumber: z.int().min(1).max(1_000_000),
    item: CorrectionItem,
    note: z.string().trim().min(1).max(correctionLimits.note),
    sources: z.array(CorrectionSource).max(correctionLimits.sources),
  })
  .refine(namesEachUploadOnce, { message: 'A request names each upload once' });
export type FileCorrectionRequest = z.infer<typeof FileCorrectionRequest>;

export const FileCorrectionResponse = z.object({ id: z.uuid() });

export const fileCorrectionRequest = {
  method: 'post',
  path: '/knowledge/corrections',
  operationId: 'fileCorrectionRequest',
  summary:
    'Files a correction request on one item of a route version, for an owner-list admin; 30 per 24 hours per account (429 rate_limited). A file source names an upload of the admin started within 2 hours and named by no request, and may name a page the version cites that it copies; filing checks its stored size, SHA-256 and type by content, and deletes an object that differs. 403 not_admin; 403 owner_list_only for an admin by grant; 404 not_found for a version, item, upload or copied page it does not hold; 409 already_corrected when a correction of the version is active; 409 not_uploaded before a file arrived; 409 upload_mismatch when a file is not what its upload declared',
  body: FileCorrectionRequest,
  response: { description: 'Filed', schema: FileCorrectionResponse },
} as const satisfies RouteDefinition<typeof FileCorrectionResponse>;

export const CorrectionRequests = z.object({
  /** Whether the viewer may file a request: an owner-list admin. */
  canFile: z.boolean(),
  /** The version's requests, newest first. */
  requests: z.array(
    z.object({
      id: z.uuid(),
      item: CorrectionItem,
      /** Null once the request's contents were erased (ADR-0029, retention); its sources go too. */
      note: z.string().nullable(),
      createdAt: z.iso.datetime({ offset: true }),
      sources: z.array(ListedCorrectionSource),
      state: z.enum(correctionStates),
      /** The retired corrector run's answer, if it gave one before ADR-0031 removed it. */
      answer: z
        .discriminatedUnion('kind', [
          z.object({ kind: z.literal('version_proposed'), number: z.int().min(1) }),
          z.object({ kind: z.literal('no_change'), explanation: z.string() }),
        ])
        .nullable(),
    }),
  ),
});
export type CorrectionRequests = z.infer<typeof CorrectionRequests>;

export const listCorrectionRequests = {
  method: 'get',
  path: '/knowledge/corrections',
  operationId: 'listCorrectionRequests',
  summary:
    "One route version's correction requests with their sources and states, newest first, for an admin. 403 not_admin; 404 not_found",
  query: VersionViewQuery,
  response: { description: 'The requests', schema: CorrectionRequests },
} as const satisfies RouteDefinition<typeof CorrectionRequests>;

/** A country as a request for a new route names it: its lower-case ISO 3166-1 alpha-2 code. */
const requestCountryCode = z.string().regex(/^[a-z]{2}$/);

/**
 * A request for a new route (ADR-0029, new routes): the country, what route the admin asks for
 * and why, and the official pages as files with their addresses, plus the passages that carry
 * each rule, pasted with the page they came from.
 */
export const FileRouteRequest = z
  .strictObject({
    countryCode: requestCountryCode,
    note: z.string().trim().min(1).max(correctionLimits.note),
    sources: z.array(CorrectionSource).min(1).max(correctionLimits.routeSources),
  })
  .refine(namesEachUploadOnce, { message: 'A request names each upload once' });
export type FileRouteRequest = z.infer<typeof FileRouteRequest>;

export const fileRouteRequest = {
  method: 'post',
  path: '/knowledge/route-requests',
  operationId: 'fileRouteRequest',
  summary:
    'Files a request for a route the catalog lacks in one country, for an owner-list admin, with up to 20 sources; the same rate limit, uploads and checks as fileCorrectionRequest, except that a file may name any https page it copies. 403 not_admin; 403 owner_list_only; 404 not_found for a country the dataset lacks or an upload it does not hold; 409 not_uploaded; 409 upload_mismatch',
  body: FileRouteRequest,
  response: { description: 'Filed', schema: FileCorrectionResponse },
} as const satisfies RouteDefinition<typeof FileCorrectionResponse>;

export const RouteRequests = z.object({
  /** Whether the viewer may file a request: an owner-list admin. */
  canFile: z.boolean(),
  /**
   * The countries a request may name, each with the hosts of its newest official-domain list,
   * none when the catalog has no list for it yet.
   */
  countries: z.array(
    z.object({ code: requestCountryCode, officialHosts: z.array(z.string().max(253)) }),
  ),
  /** Every request for a new route, newest first. */
  requests: z.array(
    z.object({
      id: z.uuid(),
      countryCode: requestCountryCode,
      /** Null once the request's contents were erased (ADR-0029, retention); its sources go too. */
      note: z.string().nullable(),
      createdAt: z.iso.datetime({ offset: true }),
      sources: z.array(ListedCorrectionSource),
      state: z.enum(correctionStates),
      /** The retired corrector run's answer, if it gave one before ADR-0031 removed it. */
      answer: z
        .discriminatedUnion('kind', [
          z.object({
            kind: z.literal('version_proposed'),
            routeId: routeIdSchema,
            number: z.int().min(1),
          }),
          z.object({ kind: z.literal('no_change'), explanation: z.string() }),
        ])
        .nullable(),
    }),
  ),
});
export type RouteRequests = z.infer<typeof RouteRequests>;

export const listRouteRequests = {
  method: 'get',
  path: '/knowledge/route-requests',
  operationId: 'listRouteRequests',
  summary:
    'Every request for a new route with its sources and state, newest first, for an admin. 403 not_admin',
  response: { description: 'The requests', schema: RouteRequests },
} as const satisfies RouteDefinition<typeof RouteRequests>;

export const StartCorrectionUpload = z.strictObject({
  mediaType: z.enum(correctionFileTypes),
  size: z.int().min(1).max(correctionLimits.fileBytes),
  /** The file's SHA-256, which the stored object must match when the request is filed. */
  sha256: Sha256,
});
export type StartCorrectionUpload = z.infer<typeof StartCorrectionUpload>;

export const StartCorrectionUploadResponse = z.object({
  uploadId: z.uuid(),
  upload: ObjectUpload,
});
export type StartCorrectionUploadResponse = z.infer<typeof StartCorrectionUploadResponse>;

export const startCorrectionUpload = {
  method: 'post',
  path: '/knowledge/corrections/uploads',
  operationId: 'startCorrectionUpload',
  summary:
    'Starts the upload of one file for a correction or update request, for any confirmed account, and says where to send it: PDF, HTML or plain text, at most 16 MB; 60 per 24 hours per account (429 rate_limited); 403 account_unconfirmed',
  body: StartCorrectionUpload,
  response: { description: 'Upload started', schema: StartCorrectionUploadResponse },
} as const satisfies RouteDefinition<typeof StartCorrectionUploadResponse>;

export const correctionUploadUrl = {
  method: 'post',
  path: '/knowledge/corrections/uploads/url',
  operationId: 'correctionUploadUrl',
  summary:
    "A presigned upload for one of the account's own unused request uploads, valid for 5 minutes and limited to its declared size and type; 60 per 24 hours per account (429 rate_limited). 403 account_unconfirmed; 404 not_found unless the pathname is such an upload started within the hour",
  body: ObjectUploadUrlRequest,
  response: { description: 'Presigned upload', schema: ObjectUploadUrlResponse },
} as const satisfies RouteDefinition<typeof ObjectUploadUrlResponse>;

export const CorrectionFileReference = z.strictObject({
  requestId: z.uuid(),
  /** The source's place in the request's list, from 0. */
  position: z
    .int()
    .min(0)
    .max(correctionLimits.routeSources - 1),
});
export type CorrectionFileReference = z.infer<typeof CorrectionFileReference>;

export const CorrectionFileUrlResponse = z.object({ url: z.string() });

export const correctionFileUrl = {
  method: 'post',
  path: '/knowledge/corrections/files/url',
  operationId: 'correctionFileUrl',
  summary:
    "A URL that downloads one request's file, as an attachment, for 5 minutes, for an owner-list admin only, since a member may attach a personal document by mistake; 120 per 24 hours per account (429 rate_limited). 403 not_admin; 403 owner_list_only for an admin by grant; 404 not_found for a source that is not a stored file",
  body: CorrectionFileReference,
  response: { description: 'Download URL', schema: CorrectionFileUrlResponse },
} as const satisfies RouteDefinition<typeof CorrectionFileUrlResponse>;

export const CloseCorrectionRequest = z.strictObject({ id: z.uuid() });
export type CloseCorrectionRequest = z.infer<typeof CloseCorrectionRequest>;

export const closeCorrectionRequest = {
  method: 'post',
  path: '/knowledge/corrections/close',
  operationId: 'closeCorrectionRequest',
  summary:
    'Closes a correction request, for an admin; closing a closed one changes nothing. 403 not_admin; 404 not_found',
  body: CloseCorrectionRequest,
  response: { description: 'Closed', schema: z.object({}) },
} as const satisfies RouteDefinition;

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
  fileCorrectionRequest,
  listCorrectionRequests,
  fileRouteRequest,
  listRouteRequests,
  closeCorrectionRequest,
  startCorrectionUpload,
  correctionUploadUrl,
  correctionFileUrl,
} as const;

export {
  type FactKey,
  correctionStates,
  correctionTargets,
  countrySetKey,
  collectionNames,
  comparisonOperators,
  expressionOperators,
  factKeys,
  factTargets,
  relationshipSteps,
  staleAfterDays,
  versionKey,
} from '@arca/domain';
