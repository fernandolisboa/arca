import {
  calendarDateSchema,
  checkItemKinds,
  checkProgressStages,
  checkProgressStates,
  checkReasons,
  checkStatuses,
  checkFailures,
  checkedBatchSkips,
  fetchOutcomes,
  listedCheckStatuses,
  maxCheckCostMicroUsd,
  maxCheckItemKeyLength,
  pageProgressOutcomes,
  progressFailures,
  maxNoteLength,
  maxAutomaticStartsPerDay,
  maxQuoteLength,
  maxQuotes,
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
  versionKey,
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
  /**
   * No date from today on selects this version: a correction or a later version replaced it, or it
   * was rejected. Recomputed on each read, so it clears if the replacing version is rejected. A
   * proposed one needs no decision and is not checked while it holds.
   */
  superseded: z.boolean(),
  /** The independent check's status (ADR-0027); `none` where no check runs. */
  check: z.enum(listedCheckStatuses),
  /**
   * How the current report's points came out, or null with no current report; a scripted report's
   * matches count as not confirmed.
   */
  points: z
    .strictObject({
      matches: z.int().min(0),
      differs: z.int().min(0),
      unread: z.int().min(0),
    })
    .nullable(),
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

const LinkSource = z.strictObject({
  kind: z.literal('link'),
  url: z
    .url({ protocol: /^https$/, hostname: z.regexes.domain })
    .max(correctionLimits.url)
    .regex(/^https:\/\/\S+$/),
});
const TextSource = z.strictObject({
  kind: z.literal('text'),
  text: z.string().trim().min(1).max(correctionLimits.text),
});

/** A source as filed: a link, pasted text, or a file uploaded first, named by its upload. */
export const CorrectionSource = z.discriminatedUnion('kind', [
  LinkSource,
  TextSource,
  z.strictObject({ kind: z.literal('file'), uploadId: z.uuid() }),
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
  }),
]);
export type ListedCorrectionSource = z.infer<typeof ListedCorrectionSource>;

export const FileCorrectionRequest = z
  .strictObject({
    routeId: routeIdSchema,
    versionNumber: z.int().min(1).max(1_000_000),
    item: CorrectionItem,
    note: z.string().trim().min(1).max(correctionLimits.note),
    sources: z.array(CorrectionSource).max(correctionLimits.sources),
  })
  .refine(
    ({ sources }) => {
      const uploads = sources.flatMap((source) =>
        source.kind === 'file' ? [source.uploadId] : [],
      );
      return new Set(uploads).size === uploads.length;
    },
    { message: 'A request names each upload once' },
  );
export type FileCorrectionRequest = z.infer<typeof FileCorrectionRequest>;

export const FileCorrectionResponse = z.object({ id: z.uuid() });

export const fileCorrectionRequest = {
  method: 'post',
  path: '/knowledge/corrections',
  operationId: 'fileCorrectionRequest',
  summary:
    'Files a correction request on one item of a route version, for an owner-list admin; 30 per 24 hours per account (429 rate_limited). A file source names an upload of the admin started within 2 hours and named by no request; filing checks its stored size, SHA-256 and type by content, and deletes an object that differs. 403 not_admin; 403 owner_list_only for an admin by grant; 404 not_found for a version, item or upload it does not hold; 409 already_corrected when a correction of the version is active; 409 not_uploaded before a file arrived; 409 upload_mismatch when a file is not what its upload declared',
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
    'Starts the upload of one file for a correction request, for an owner-list admin, and says where to send it: PDF, HTML or plain text, at most 16 MB; 60 per 24 hours per account (429 rate_limited). 403 not_admin; 403 owner_list_only',
  body: StartCorrectionUpload,
  response: { description: 'Upload started', schema: StartCorrectionUploadResponse },
} as const satisfies RouteDefinition<typeof StartCorrectionUploadResponse>;

export const correctionUploadUrl = {
  method: 'post',
  path: '/knowledge/corrections/uploads/url',
  operationId: 'correctionUploadUrl',
  summary:
    "A presigned upload for one of the admin's own unused correction uploads, valid for 5 minutes and limited to its declared size and type; 60 per 24 hours per account (429 rate_limited). 403 not_admin; 403 owner_list_only; 404 not_found unless the pathname is such an upload started within the hour",
  body: ObjectUploadUrlRequest,
  response: { description: 'Presigned upload', schema: ObjectUploadUrlResponse },
} as const satisfies RouteDefinition<typeof ObjectUploadUrlResponse>;

export const CorrectionFileReference = z.strictObject({
  requestId: z.uuid(),
  /** The source's place in the request's list, from 0. */
  position: z
    .int()
    .min(0)
    .max(correctionLimits.sources - 1),
});
export type CorrectionFileReference = z.infer<typeof CorrectionFileReference>;

export const CorrectionFileUrlResponse = z.object({ url: z.string() });

export const correctionFileUrl = {
  method: 'post',
  path: '/knowledge/corrections/files/url',
  operationId: 'correctionFileUrl',
  summary:
    "A URL that downloads one request's file, as an attachment, for 5 minutes, for an admin; 120 per 24 hours per account (429 rate_limited). 403 not_admin; 404 not_found for a source that is not a stored file",
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

/*
 * The independent check (ADR-0027). The activation screen asks, when it opens, for checks of every
 * proposed route version that has no current report and no live start, within its share of the 20
 * starts in any 24 hours per environment; listing versions starts nothing. A report is model output that code
 * checked against the cited official pages: plain text, quotes and URLs included, never links.
 */

export const StartVersionChecksResponse = z.strictObject({
  started: z.int().min(0).max(maxAutomaticStartsPerDay),
});
export type StartVersionChecksResponse = z.infer<typeof StartVersionChecksResponse>;

export const startVersionChecks = {
  method: 'post',
  path: '/knowledge/checks/start',
  operationId: 'startVersionChecks',
  summary:
    'Starts the independent check of every proposed route version with no current report and no check running, within 15 automatic starts in any 24 hours per environment, counting every start in the window; answers how many started. 403 not_admin',
  response: { description: 'Started', schema: StartVersionChecksResponse },
} as const satisfies RouteDefinition<typeof StartVersionChecksResponse>;

export const VersionCheckReport = z.strictObject({
  checkedAt: z.iso.datetime(),
  /** Every item matches; never for a scripted report. */
  clean: z.boolean(),
  /** Written by the scripted checker used until a model is configured, never clean. */
  scripted: z.boolean(),
  failure: z.enum(checkFailures).nullable(),
  /** The country guide the check read, or null when the country has none. */
  guide: z
    .strictObject({ country: z.string().regex(/^[A-Z]{2}$/), number: z.int().min(1) })
    .nullable(),
  items: z
    .array(
      z.strictObject({
        key: z.string().max(maxCheckItemKeyLength),
        kind: z.enum(checkItemKinds),
        title: z.string().max(200),
        status: z.enum(checkStatuses),
        /** The verified passages it rests on, each with its page; empty when not checked. */
        quotes: z
          .array(
            z.strictObject({
              quote: z.string().max(maxQuoteLength),
              url: z.string().max(2_000),
            }),
          )
          .max(maxQuotes),
        note: z.string().max(maxNoteLength).nullable(),
        reason: z.enum(checkReasons).nullable(),
        /**
         * The official sources the item cites, from the bundled version, never from the model: where
         * an admin looks when the check could not confirm it.
         */
        citations: z
          .array(z.strictObject({ url: sourceSchema.shape.url, title: sourceSchema.shape.title }))
          .max(100),
        /** What those pages must state for the item to hold; empty when it states no value. */
        values: z
          .array(
            z.discriminatedUnion('kind', [
              z.strictObject({ kind: z.literal('number'), value: z.string().max(40) }),
              z.strictObject({ kind: z.literal('date'), value: calendarDateSchema }),
            ]),
          )
          .max(100),
      }),
    )
    .max(200),
  fetchLog: z
    .array(
      z.strictObject({
        url: z.string().max(2_000),
        /** The address read in the page's place, so the admin sees where a quote's text came from. */
        machineReadableUrl: z.string().max(2_000).nullable(),
        outcome: z.enum(fetchOutcomes),
        status: z.int().min(0).max(999).nullable(),
        cut: z.boolean(),
      }),
    )
    .max(200),
});
export type VersionCheckReport = z.infer<typeof VersionCheckReport>;

export const VersionCheck = z.strictObject({
  /** Whether this environment runs the check; off in production until a model is configured. */
  enabled: z.boolean(),
  status: z.enum(listedCheckStatuses),
  /** The current report, or null when the version has none (stale, running or never checked). */
  report: VersionCheckReport.nullable(),
});
export type VersionCheck = z.infer<typeof VersionCheck>;

export const getVersionCheck = {
  method: 'get',
  path: '/knowledge/versions/check',
  operationId: 'getVersionCheck',
  summary:
    "One route version's independent check status and its current report, model output checked in code against the cited official pages; never starts a check. 403 not_admin, 404 not_found",
  query: VersionViewQuery,
  response: { description: 'The check', schema: VersionCheck },
} as const satisfies RouteDefinition<typeof VersionCheck>;

/*
 * The check on demand (ADR-0027, "On demand, with progress"): an admin starts one route version's
 * check, whatever its state and reports, and watches how far it got. Progress holds counts, cited
 * official URLs, item statuses and fixed codes only; what the model wrote comes with the report.
 */

export const StartVersionCheckResponse = z.strictObject({
  /** False when a check of the version was already running, which is the one to watch. */
  started: z.boolean(),
});
export type StartVersionCheckResponse = z.infer<typeof StartVersionCheckResponse>;

export const startVersionCheck = {
  method: 'post',
  path: '/knowledge/versions/check/start',
  operationId: 'startVersionCheck',
  summary:
    'Starts a new independent check of one route version for an admin, in any state and whatever its current report; while a check of the version is running it answers that one and starts nothing. No daily cap; 10 requests per minute per account (429 rate_limited). 403 not_admin; 404 not_found; 502 check_not_started when its run could not begin, which then counts as running for up to 30 minutes; 503 check_off where no checker is configured',
  body: DecideVersionRequest,
  response: { description: 'Started, or already running', schema: StartVersionCheckResponse },
} as const satisfies RouteDefinition<typeof StartVersionCheckResponse>;

/** Millionths of a U.S. dollar, computed in code from the reviewed price table. */
const microUsd = z.int().min(0).max(maxCheckCostMicroUsd);

/**
 * What a check's model calls cost: `unknown` when a model has no price or the provider left a
 * count out, `scripted` when the scripted checker ran, which is a test and costs nothing.
 */
export const CheckCost = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('priced'), microUsd }),
  z.strictObject({ kind: z.literal('unknown') }),
  z.strictObject({ kind: z.literal('scripted') }),
]);
export type CheckCost = z.infer<typeof CheckCost>;

export const CheckProgress = z.strictObject({
  startedAt: z.iso.datetime(),
  /** `dead` when the start is 30 minutes old with neither a report nor a recorded failure. */
  state: z.enum(checkProgressStates),
  /** The last stage the check entered. */
  stage: z.enum(checkProgressStages),
  itemCount: z.int().min(0).max(1_000).nullable(),
  pageCount: z.int().min(0).max(1_000).nullable(),
  /** Each cited page in the order first read, with its latest outcome; plain text, never a link. */
  pages: z
    .array(
      z.strictObject({
        url: z.string().max(2_000),
        outcome: z.enum(pageProgressOutcomes),
        /** The final HTTP status once read or refused, when there was one. */
        status: z.int().min(0).max(999).nullable(),
      }),
    )
    .max(200),
  /** How many long pages had passages picked, once that stage began. */
  locatedPages: z.int().min(0).max(1_000).nullable(),
  /**
   * Every item of the version in its order, with its status once the checker answered it and code
   * verified it, or null while awaited; quotes, notes and reasons come only with the report.
   */
  items: z
    .array(
      z.strictObject({
        key: z.string().max(maxCheckItemKeyLength),
        kind: z.enum(checkItemKinds),
        title: z.string().max(200),
        status: z.enum(checkStatuses).nullable(),
      }),
    )
    .max(200),
  /** The scripted checker answers here, so a match is a test's and never a confirmation. */
  scripted: z.boolean(),
  failure: z.enum(progressFailures).nullable(),
  /** What its model calls cost so far, or null before the first one (see `CheckCost`). */
  cost: CheckCost.nullable(),
});
export type CheckProgress = z.infer<typeof CheckProgress>;

export const VersionCheckProgress = z.strictObject({
  /** The version's newest start of the last 24 hours, or null with none or where no check runs. */
  progress: CheckProgress.nullable(),
  /** What the version's newest check whose report did not fail cost, when it could be priced. */
  lastCostMicroUsd: microUsd.nullable(),
});
export type VersionCheckProgress = z.infer<typeof VersionCheckProgress>;

export const getVersionCheckProgress = {
  method: 'get',
  path: '/knowledge/versions/check/progress',
  operationId: 'getVersionCheckProgress',
  summary:
    "How far one route version's newest independent check of the last 24 hours got, for an admin: its state, stage, the cited pages read so far and what its model calls cost; and what the version's newest check whose report did not fail cost. Never starts a check. 403 not_admin, 404 not_found",
  query: VersionViewQuery,
  response: { description: 'The progress', schema: VersionCheckProgress },
} as const satisfies RouteDefinition<typeof VersionCheckProgress>;

/* Activating every checked version at once (ADR-0027): the identities the screen showed. */

const shownVersion = z.strictObject({
  routeId: routeIdSchema,
  number: z.int().min(1).max(1_000_000),
  hash: contentHash,
});

export const ActivateCheckedRequest = z.strictObject({
  versions: z
    .array(shownVersion)
    .min(1)
    .max(100)
    .refine((list) => new Set(list.map(versionKey)).size === list.length, 'each version once'),
});
export type ActivateCheckedRequest = z.infer<typeof ActivateCheckedRequest>;

export const ActivateCheckedResponse = z.strictObject({
  activated: z
    .array(
      z.strictObject({
        routeId: routeIdSchema,
        number: z.int().min(1),
        decisionId: z.uuid(),
      }),
    )
    .max(100),
  skipped: z
    .array(
      z.strictObject({
        routeId: routeIdSchema,
        number: z.int().min(1),
        reason: z.enum(checkedBatchSkips),
      }),
    )
    .max(100),
});
export type ActivateCheckedResponse = z.infer<typeof ActivateCheckedResponse>;

export const activateCheckedVersions = {
  method: 'post',
  path: '/knowledge/versions/activate-checked',
  operationId: 'activateCheckedVersions',
  summary:
    'Activates, for a signed-in admin with no step-up, each shown route version that is still proposed, matches the bundled hash and has a clean current independent check, one decision each; answers which were activated and which were skipped, with a reason each. 403 not_admin',
  body: ActivateCheckedRequest,
  response: { description: 'Activated and skipped', schema: ActivateCheckedResponse },
} as const satisfies RouteDefinition<typeof ActivateCheckedResponse>;

export const knowledgeRoutes = {
  activateVersion,
  rejectVersion,
  activateCheckedVersions,
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
  closeCorrectionRequest,
  startCorrectionUpload,
  correctionUploadUrl,
  correctionFileUrl,
  startVersionChecks,
  getVersionCheck,
  startVersionCheck,
  getVersionCheckProgress,
} as const;

export {
  type FactKey,
  correctionStates,
  correctionTargets,
  countrySetKey,
  checkReasons,
  collectionNames,
  comparisonOperators,
  expressionOperators,
  factKeys,
  factTargets,
  maxAutomaticStartsPerDay,
  maxQuotes,
  relationshipSteps,
  staleAfterDays,
  versionKey,
} from '@arca/domain';
