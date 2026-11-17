import {
  maxCheckCostMicroUsd,
  maxCheckItemKeyLength,
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
  /** The number the proposal was stored under as a proposed version, once the request finished. */
  proposedNumber: z.int().min(1).nullable(),
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

export const updateRequestRoutes = {
  startUpdateRequest,
  getNewestUpdateRequest,
  getVersionReview,
  editVersionItem,
} as const;
