import {
  countryCodeSchema,
  maxCheckCostMicroUsd,
  maxCheckItemKeyLength,
  proposalLists,
  routeIdSchema,
  slugSchema,
  memberRequestStates,
  releasedRuns,
  updateFailures,
  updateStages,
} from '@arca/domain';
import { z } from 'zod';
import type { RouteDefinition } from './index.js';
import { ListedCorrectionSource, correctionLimits, requestUrl } from './knowledge.js';

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
    "Starts, for an admin, an update request for one route's newest version: research, validation, at most one correction and a final validation, then a proposal. 10 per account per hour (429 rate_limited). 403 not_admin; 404 not_found for a route with no version; 409 update_live while a request of the route runs; 409 list_pending while the version pins a first official-domain list nobody activated, whose hosts research may not read yet; 502 update_not_started when the run could not begin, which then counts as running for up to an hour; 503 update_off where the AI keys are not set",
  body: StartUpdateRequest,
  response: { description: 'Started', schema: StartedUpdateRequest },
} as const satisfies RouteDefinition<typeof StartedUpdateRequest>;

export const UpdateRequestQuery = z.strictObject({ routeId: routeIdSchema });

/** A stage as the progress shows it. */
export const updateStageStates = ['done', 'failed', 'running', 'pending', 'skipped'] as const;

/** What every request's progress shows, an update of a route or a new route alike. */
const requestProgress = {
  requestId: z.uuid(),
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
  /** The number the proposal was stored under as a proposed version, once the request finished. */
  proposedNumber: z.int().min(1).nullable(),
};

export const UpdateProgress = z.strictObject({
  ...requestProgress,
  routeId: routeIdSchema,
  baseNumber: z.int().min(1),
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

/*
 * New-route requests (ADR-0031, #461): an admin names a country from the dataset and a visa or
 * entry type the catalog lacks, with official links. The same pipeline researches the route's
 * first version, its cases and, for a country with no approved official-domain list, its first
 * list, which the admin decides apart, before the route.
 */

/** The most links a new-route request names. */
export const maxNewRouteLinks = 10;

export const StartNewRouteRequest = z.strictObject({
  country: countryCodeSchema,
  /**
   * The visa or entry type, as the admin names it; research reads it as data. It goes to the
   * model as typed, so a run of five digits or an `@`, as in a document number or an address, is
   * refused.
   */
  visa: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .refine((text) => !/\d{5}|@/.test(text), 'A visa name, not personal data'),
  /**
   * Official pages to start from: for a country with approved lists, those on them reach research
   * as addresses; for a country with none, their hosts are the hosts research may start on.
   */
  links: z
    .array(z.url({ protocol: /^https$/ }).max(2000))
    .max(maxNewRouteLinks)
    .default([]),
});
export type StartNewRouteRequest = z.input<typeof StartNewRouteRequest>;

export const startNewRouteRequest = {
  method: 'post',
  path: '/knowledge/new-route-requests',
  operationId: 'startNewRouteRequest',
  summary:
    "Starts, for an admin, a request for a new route of one country: research of its first version and cases on the country's approved official-domain lists or, for a country with none, from the hosts of the links given, proposing its first list; then validation, at most one correction and a final validation. 10 per account per hour (429 rate_limited). 403 not_admin; 404 not_found for a country outside the dataset; 409 update_live while a new-route request of the country runs; 400 links_needed for a country with no approved list and no link; 502 update_not_started; 503 update_off where the AI keys are not set",
  body: StartNewRouteRequest,
  response: { description: 'Started', schema: StartedUpdateRequest },
} as const satisfies RouteDefinition<typeof StartedUpdateRequest>;

export const NewRouteProgress = z.strictObject({
  ...requestProgress,
  country: countryCodeSchema,
  visa: z.string().max(120),
  /** Whether the country had no approved list, so the request proposes its first. */
  newCountry: z.boolean(),
  /** The route ID the proposal took, once the request finished. */
  proposedRouteId: routeIdSchema.nullable(),
});
export type NewRouteProgress = z.infer<typeof NewRouteProgress>;

export const NewRouteRequests = z.strictObject({
  requests: z.array(NewRouteProgress).max(10),
  /** The country dataset's current codes, the countries a request may name. */
  countries: z.array(countryCodeSchema).max(400),
  /** The countries with an approved official-domain list, where a link is optional. */
  countriesWithLists: z.array(countryCodeSchema).max(400),
});
export type NewRouteRequests = z.infer<typeof NewRouteRequests>;

export const getNewRouteRequests = {
  method: 'get',
  path: '/knowledge/new-route-requests',
  operationId: 'getNewRouteRequests',
  summary:
    'The ten newest new-route requests with their progress by stage and what they cost, the countries a request may name and those with an approved official-domain list; never calls a model. 403 not_admin',
  response: { description: 'The newest requests', schema: NewRouteRequests },
} as const satisfies RouteDefinition<typeof NewRouteRequests>;

/*
 * Reviewing one route version (ADR-0031): its items in the three lists the request that proposed it
 * ended with, an admin's hand edits marked, and the content of each item an admin may edit. The
 * items are public rule data; the quotes are text code found on official pages, shown as plain
 * text, never as markup.
 */

export const VersionReviewQuery = z.strictObject({
  routeId: routeIdSchema,
  number: z.coerce.number<number>().int().min(1).max(1_000_000),
});

const officialUrl = z.string().max(2000);

export const ReviewItem = z.strictObject({
  key: z.string().max(maxCheckItemKeyLength),
  kind: z.string().max(40),
  title: z.string().max(200),
  list: z.enum(proposalLists),
  /** Why an item is divergent or could not be confirmed: a fixed code, or null. */
  reason: z.string().max(40).nullable(),
  quotes: z.array(z.strictObject({ url: officialUrl, quote: z.string().max(2000) })).max(5),
  urls: z.array(officialUrl).max(20),
  /** An admin wrote this item by hand in this version or one it corrects. */
  edited: z.boolean(),
});
export type ReviewItem = z.infer<typeof ReviewItem>;

/** The longest item an admin edits, as JSON text. */
export const maxItemJsonLength = 100_000;

/** The item kinds an admin may edit by hand: those listed in the version with an ID. */
export const editableItemKinds = [
  'requirement',
  'assessment',
  'dependent',
  'cost',
  'duration',
] as const;

/**
 * A first official-domain list a new-route request proposed (ADR-0031): each host with the
 * registry page code found it on. It is decided apart, before the route that pins it.
 */
export const ProposedDomainList = z.strictObject({
  listId: slugSchema,
  number: z.int().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  state: z.enum(['active', 'rejected', 'proposed']),
  issuer: z.string().max(200),
  hosts: z
    .array(
      z.strictObject({
        host: z.string().max(253),
        proof: z.strictObject({ url: officialUrl, title: z.string().max(200) }),
      }),
    )
    .max(100),
});
export type ProposedDomainList = z.infer<typeof ProposedDomainList>;

export const VersionReview = z.strictObject({
  /**
   * Where the lists come from: the update request that proposed this version, a hand edit of one,
   * or nothing for a version no request proposed.
   */
  origin: z.enum(['request', 'edit', 'none']),
  items: z.array(ReviewItem).max(400),
  /** Each item an admin may edit, with its content as the version holds it, as indented JSON. */
  editable: z
    .array(
      z.strictObject({
        key: z.string().max(maxCheckItemKeyLength),
        kind: z.enum(editableItemKinds),
        title: z.string().max(200),
        content: z.string().max(maxItemJsonLength),
      }),
    )
    .max(200),
  /**
   * The first official-domain list the version pins and a new-route request proposed, if any. Until
   * it is active, every item shows as not confirmed and the version cannot be activated.
   */
  domainList: ProposedDomainList.nullable(),
});
export type VersionReview = z.infer<typeof VersionReview>;

export const getVersionReview = {
  method: 'get',
  path: '/knowledge/versions/review',
  operationId: 'getVersionReview',
  summary:
    "One route version's items in the three lists its update request ended with, hand edits marked, and the content of each item an admin may edit; never calls a model. 403 not_admin, 404 not_found",
  query: VersionReviewQuery,
  response: { description: 'The review', schema: VersionReview },
} as const satisfies RouteDefinition<typeof VersionReview>;

export const EditItemRequest = z.strictObject({
  routeId: routeIdSchema,
  /** The version the edit corrects. */
  number: z.int().min(1).max(1_000_000),
  itemKey: z.string().min(1).max(maxCheckItemKeyLength),
  /** The item as the admin wrote it, as JSON, with the same ID; checked by the rule schema. */
  content: z.string().min(2).max(maxItemJsonLength),
  /** The official page that states it, and the passage that does. */
  source: z.strictObject({
    url: z.url({ protocol: /^https$/ }).max(2000),
    title: z.string().trim().min(1).max(200),
  }),
  quote: z.string().trim().min(1).max(2000),
});
export type EditItemRequest = z.infer<typeof EditItemRequest>;

export const EditItemResponse = z.discriminatedUnion('outcome', [
  /** Stored as a new proposed version that corrects the edited one. */
  z.strictObject({ outcome: z.literal('stored'), number: z.int().min(1) }),
  /** Code refused it, each reason as the rule schema or the page check states it. */
  z.strictObject({ outcome: z.literal('refused'), problems: z.array(z.string().max(500)).max(50) }),
]);
export type EditItemResponse = z.infer<typeof EditItemResponse>;

export const editVersionItem = {
  method: 'post',
  path: '/knowledge/versions/edit-item',
  operationId: 'editVersionItem',
  summary:
    "Stores, for an admin, a new proposed route version with one item edited by hand, which corrects the version named: checked in code as a proposal is (the rule schema, official hosts, the version's cases) and with the quote found on the official page it cites, or refused with the reasons. Decided like any version. 10 per account per hour (429 rate_limited). 403 not_admin; 404 not_found for a version or item the rules do not hold; 409 already_rejected; 409 update_live while a request of the route runs; 409 version_taken when another version was stored meanwhile",
  body: EditItemRequest,
  response: { description: 'Stored or refused', schema: EditItemResponse },
} as const satisfies RouteDefinition<typeof EditItemResponse>;

/*
 * Deciding a first official-domain list (ADR-0031): as for a route version, after a
 * knowledge_decision step-up bound to its content hash, with step-up actions of its own.
 */

export const DecideOfficialDomainsRequest = z.strictObject({
  listId: slugSchema,
  number: z.int().min(1).max(1_000_000),
});
export type DecideOfficialDomainsRequest = z.infer<typeof DecideOfficialDomainsRequest>;

const DecidedOfficialDomains = z.object({ decisionId: z.uuid() });

export const activateOfficialDomains = {
  method: 'post',
  path: '/knowledge/official-domains/activate',
  operationId: 'activateOfficialDomains',
  summary:
    'Activates a first official-domain list a new-route request proposed, for an admin after a knowledge_decision step-up bound to its hash. 403 not_admin, 403 step_up_required, 404 not_found for a list no request proposed, 409 already_rejected',
  body: DecideOfficialDomainsRequest,
  response: { description: 'Activated', schema: DecidedOfficialDomains },
} as const satisfies RouteDefinition<typeof DecidedOfficialDomains>;

export const rejectOfficialDomains = {
  method: 'post',
  path: '/knowledge/official-domains/reject',
  operationId: 'rejectOfficialDomains',
  summary:
    'Rejects a first official-domain list a new-route request proposed and nobody activated, for an admin after a knowledge_decision step-up bound to its hash, for good; a route version that pins it can then never be activated. 403 not_admin, 403 step_up_required, 404 not_found, 409 already_rejected, 409 list_active once the list is active, since a route that pins it may be in use',
  body: DecideOfficialDomainsRequest,
  response: { description: 'Rejected', schema: DecidedOfficialDomains },
} as const satisfies RouteDefinition<typeof DecidedOfficialDomains>;

/** The step-up action of a list decision: ID and number targets, the hash a field. */
export function decideOfficialDomainsAction(
  decision: 'activateOfficialDomains' | 'rejectOfficialDomains',
  { listId, number }: DecideOfficialDomainsRequest,
  contentHash: string,
) {
  return { action: decision, targets: [listId, String(number)], fields: { contentHash } };
}

/*
 * Members' update requests (ADR-0031, #462): any member asks for the route version they are
 * looking at to be updated, with an optional note, links and files for the admin to read. It waits
 * until an admin releases it, which starts an update request of the route, or declines it. Nothing
 * a member writes or attaches reaches a model.
 */

export const FileMemberUpdateRequest = z
  .strictObject({
    routeId: routeIdSchema,
    versionNumber: z.int().min(1).max(1_000_000),
    note: z.string().trim().min(1).max(correctionLimits.note).optional(),
    links: z.array(requestUrl).max(correctionLimits.sources).default([]),
    /** Uploads of the member started within 2 hours and named by no request. */
    files: z.array(z.uuid()).max(correctionLimits.sources).default([]),
  })
  .refine(({ links, files }) => links.length + files.length <= correctionLimits.sources, {
    message: 'At most five links and files together',
  })
  .refine(({ files }) => new Set(files).size === files.length, {
    message: 'A request names each upload once',
  });
export type FileMemberUpdateRequest = z.input<typeof FileMemberUpdateRequest>;

export const FiledMemberUpdateRequest = z.strictObject({ id: z.uuid() });

export const fileMemberUpdateRequest = {
  method: 'post',
  path: '/knowledge/member-update-requests',
  operationId: 'fileMemberUpdateRequest',
  summary:
    "Files, for any signed-in account, a request to update one route version it sees, with an optional note, links and files; it waits for an admin, and the owner-list admins are emailed. 30 per 24 hours per account (429 rate_limited). 404 not_found for a version or upload it does not hold; 409 update_live while a member's request of the route waits or an update request of the route runs; 409 not_uploaded before a file arrived; 409 upload_mismatch when a file is not what its upload declared",
  body: FileMemberUpdateRequest,
  response: { description: 'Filed', schema: FiledMemberUpdateRequest },
} as const satisfies RouteDefinition<typeof FiledMemberUpdateRequest>;

/** A member's request as its author sees it: never another member's. */
export const OwnUpdateRequest = z.strictObject({
  id: z.uuid(),
  routeId: routeIdSchema,
  versionNumber: z.int().min(1),
  createdAt: z.iso.datetime(),
  state: z.enum(memberRequestStates),
  /** The admin's reason, on a declined request that gave one. */
  reason: z.string().max(500).nullable(),
});
export type OwnUpdateRequest = z.infer<typeof OwnUpdateRequest>;

export const OwnUpdateRequests = z.strictObject({ requests: z.array(OwnUpdateRequest).max(50) });
export type OwnUpdateRequests = z.infer<typeof OwnUpdateRequests>;

export const getOwnUpdateRequests = {
  method: 'get',
  path: '/knowledge/member-update-requests/own',
  operationId: 'getOwnUpdateRequests',
  summary: "The signed-in account's own newest update requests with their state",
  response: { description: 'Their own requests', schema: OwnUpdateRequests },
} as const satisfies RouteDefinition<typeof OwnUpdateRequests>;

export const MemberUpdateRequest = z.strictObject({
  id: z.uuid(),
  routeId: routeIdSchema,
  versionNumber: z.int().min(1),
  createdAt: z.iso.datetime(),
  /** Null when the member wrote none, or once the retention step erased it. */
  note: z.string().max(correctionLimits.note).nullable(),
  erased: z.boolean(),
  /** Links and files in order; a file opens through `correctionFileUrl`, for an owner-list admin. */
  sources: z.array(ListedCorrectionSource).max(correctionLimits.sources),
  state: z.enum(memberRequestStates),
  /** How the update request its release started stands, once released. */
  run: z.enum(releasedRuns).nullable(),
  reason: z.string().max(500).nullable(),
  canRelease: z.boolean(),
  canDecline: z.boolean(),
});
export type MemberUpdateRequest = z.infer<typeof MemberUpdateRequest>;

export const MemberUpdateRequests = z.strictObject({
  /** Whether the admin may download members' files: owner-list admins only. */
  canDownload: z.boolean(),
  requests: z.array(MemberUpdateRequest).max(50),
});
export type MemberUpdateRequests = z.infer<typeof MemberUpdateRequests>;

export const getMemberUpdateRequests = {
  method: 'get',
  path: '/knowledge/member-update-requests',
  operationId: 'getMemberUpdateRequests',
  summary: "The newest members' update requests, for an admin. 403 not_admin",
  response: { description: "Members' requests", schema: MemberUpdateRequests },
} as const satisfies RouteDefinition<typeof MemberUpdateRequests>;

export const MemberUpdateRequestReference = z.strictObject({ id: z.uuid() });

export const releaseMemberUpdateRequest = {
  method: 'post',
  path: '/knowledge/member-update-requests/release',
  operationId: 'releaseMemberUpdateRequest',
  summary:
    "Releases, for an admin, a member's waiting request: starts an update request of the route's newest version, as startUpdateRequest does, and records the release in the same transaction. 10 per account per hour (429 rate_limited), shared with startUpdateRequest. 403 not_admin; 404 not_found; 409 decided for a request already released or declined; then startUpdateRequest's refusals",
  body: MemberUpdateRequestReference,
  response: { description: 'Released', schema: StartedUpdateRequest },
} as const satisfies RouteDefinition<typeof StartedUpdateRequest>;

export const DeclineMemberUpdateRequest = z.strictObject({
  id: z.uuid(),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type DeclineMemberUpdateRequest = z.input<typeof DeclineMemberUpdateRequest>;

export const DeclinedMemberUpdateRequest = z.strictObject({});

export const declineMemberUpdateRequest = {
  method: 'post',
  path: '/knowledge/member-update-requests/decline',
  operationId: 'declineMemberUpdateRequest',
  summary:
    "Declines, for an admin, a member's request that waits, or whose release ended with no proposal, with an optional reason the member reads. 403 not_admin; 404 not_found; 409 decided otherwise",
  body: DeclineMemberUpdateRequest,
  response: { description: 'Declined', schema: DeclinedMemberUpdateRequest },
} as const satisfies RouteDefinition<typeof DeclinedMemberUpdateRequest>;

export const updateRequestRoutes = {
  startUpdateRequest,
  getNewestUpdateRequest,
  startNewRouteRequest,
  getNewRouteRequests,
  activateOfficialDomains,
  rejectOfficialDomains,
  getVersionReview,
  editVersionItem,
  fileMemberUpdateRequest,
  getOwnUpdateRequests,
  getMemberUpdateRequests,
  releaseMemberUpdateRequest,
  declineMemberUpdateRequest,
} as const;
