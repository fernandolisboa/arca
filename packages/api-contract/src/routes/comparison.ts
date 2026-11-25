import {
  comparisonPreferencesRequestSchema,
  comparisonPreferencesSchema,
  countryCodeSchema,
  criterionIdSchema,
  criterionNameSchema,
  decimalSchema,
  maxCriterionKeys,
  maxDismissed,
  maxOwnCriteria,
  maxOwnCriterionName,
  ownCriterionIdSchema,
  plainSourceSchema,
  regionCodeSchema,
  slugSchema,
  sourceSchema,
  weightSchema,
} from '@arca/domain';
import { z } from 'zod';
import { RouteResult } from './case.js';
import type { RouteDefinition } from './index.js';

export { newlyNamed, plainName } from '@arca/domain';

/*
 * The destination comparison (ADR-0026, #310): one adult's ranking of the countries that have a
 * route, from their own weights and ratings. Like the case routes, it needs a session and a
 * confirmed account (401, 403 account_unconfirmed) and answers 404 not_found outside a case.
 * Preferences are the caller's alone: no other member, and no model, ever reads them.
 */

/** How many own criteria a person may create, so the screen stops offering more. */
export const ownCriteriaLimit = maxOwnCriteria;
/** The longest own criterion name the API takes, for the screen's field. */
export const ownCriterionNameLimit = maxOwnCriterionName;
/** How many turned-down suggestions the API keeps, so the screen drops the oldest past it. */
export const maxDismissedSuggestions = maxDismissed;

const weights = { weight: weightSchema, defaultWeight: weightSchema };

export const ComparedCriterion = z.union([
  z.object({
    id: criterionIdSchema,
    kind: z.enum(['indicator', 'category', 'personal']),
    /** The knowledge title; the screen shows its own label for the ID when it has one. */
    title: z.string().max(200),
    /** The indicator an objective criterion reads, and what its values measure, such as "per 100,000 people". */
    indicator: z.object({ id: slugSchema, unit: z.string().max(200) }).optional(),
    ...weights,
  }),
  z.object({
    id: ownCriterionIdSchema,
    kind: z.literal('own'),
    /** The caller's own name for it: case data, never logged. */
    name: z.string().max(maxOwnCriterionName),
    ...weights,
  }),
]);

export const CriterionScore = z.object({
  criterion: z.union([criterionIdSchema, ownCriterionIdSchema]),
  /** From 0 to 10, one decimal place; null when unknown ("sem dado" or not rated yet). */
  score: decimalSchema.nullable(),
  /** The indicator value an objective score comes from. */
  reading: z
    .object({
      value: z.string().max(40),
      year: z.int().min(1900).max(2200),
      source: sourceSchema,
      /** Verified more than 90 days ago. */
      stale: z.boolean(),
    })
    .optional(),
  /** The caller's stars, on a personal or own criterion they rated. */
  rating: z.int().min(1).max(5).optional(),
  /**
   * The stars Arca suggests from a public source (ADR-0035): they score the criterion until the
   * caller rates it, and the caller's own stars always win.
   */
  suggested: z
    .object({
      /** The suggestion key, such as `climate` or `housing-cost`, which the screen words the value by. */
      key: slugSchema,
      stars: z.int().min(1).max(5),
      /** A decimal string or a token such as `es`, which the screen words by criterion. */
      value: z.string().max(40),
      year: z.int().min(1900).max(2200).optional(),
      source: plainSourceSchema,
      /** Its source was verified more than 90 days ago. */
      stale: z.boolean(),
    })
    .optional(),
  /**
   * On a region: it has no stars or data of its own on this criterion, so it takes its country's
   * score (ADR-0042), which the country's line explains.
   */
  inherited: z.literal(true).optional(),
});

/** A region inside a country (ADR-0042), scored with the caller's weights; visas stay national. */
export const ComparedRegion = z.object({
  /** Its ISO 3166-2 code, such as `PT-20`; the caller's ratings for it are keyed by it. */
  region: regionCodeSchema,
  /** Its place among the country's regions; null while it has no total. */
  rank: z.int().min(1).nullable(),
  total: decimalSchema.nullable(),
  coverage: z.int().min(0).max(100),
  scores: z.array(CriterionScore).max(maxCriterionKeys),
});

export const ComparedCountry = z.object({
  country: countryCodeSchema,
  /** `few-data` is "Poucos dados": under half the weight known; `hidden` is unranked. */
  group: z.enum(['ranked', 'few-data', 'hidden']),
  rank: z.int().min(1).nullable(),
  total: decimalSchema.nullable(),
  /** The share of the weight with a known score, a whole percentage rounded down. */
  coverage: z.int().min(0).max(100),
  scores: z.array(CriterionScore).max(maxCriterionKeys),
  /** The best status the caller has over the country's routes; it never changes the score. */
  routeStatus: RouteResult.shape.status.nullable(),
  /** The country's regions, ranked; empty when Arca has no regional data for it. */
  regions: z.array(ComparedRegion).max(100),
});

export const DestinationComparison = z.object({
  /** The active comparison version; null while none is, and only own criteria are scored. */
  version: z.object({ comparisonId: slugSchema, number: z.int().min(1) }).nullable(),
  /** A newer comparison version waits for activation. */
  pendingNewer: z.boolean(),
  criteria: z.array(ComparedCriterion).max(maxCriterionKeys),
  /** Ranked first, then "Poucos dados", then the hidden countries. */
  countries: z.array(ComparedCountry).max(300),
  /** What the caller chose, to edit and write back whole. */
  preferences: comparisonPreferencesSchema,
});
export type DestinationComparison = z.infer<typeof DestinationComparison>;

export const getComparison = {
  method: 'get',
  path: '/comparison',
  operationId: 'getComparison',
  summary:
    "The caller's destination comparison: every country with a route, scored from the active comparison version and the caller's weights and ratings, ranked, with the caller's best route status beside each; 60 per hour per session (429 rate_limited); 404 not_found outside a case",
  response: { description: 'The comparison', schema: DestinationComparison },
} as const satisfies RouteDefinition<typeof DestinationComparison>;

/** An own criterion without an ID is new; the API names it. */
export const WriteComparisonPreferencesRequest = comparisonPreferencesRequestSchema;
export type WriteComparisonPreferencesRequest = z.infer<typeof WriteComparisonPreferencesRequest>;

export const writeComparisonPreferences = {
  method: 'put',
  path: '/comparison/preferences',
  operationId: 'writeComparisonPreferences',
  summary:
    "Replaces the caller's comparison preferences and answers the comparison they give; an own criterion it drops takes its weights and ratings with it. Counts as a case write (429 rate_limited); 404 not_found outside a case; 409 case_invalid for an own criterion ID the caller does not have",
  body: WriteComparisonPreferencesRequest,
  response: { description: 'The comparison', schema: DestinationComparison },
} as const satisfies RouteDefinition<typeof DestinationComparison>;

/** Most criteria one suggestion answers; the prompt asks for six, so two are margin. */
export const maxSuggestedCriteria = 8;

/**
 * A request for suggestions carries nothing: the API sends the model only the names the screen
 * already shows, from the interface's catalog, so nothing a person typed can reach it.
 */
export const SuggestCriteriaRequest = z.strictObject({});
export type SuggestCriteriaRequest = z.infer<typeof SuggestCriteriaRequest>;

export const SuggestedCriteria = z.strictObject({
  suggestions: z
    .array(z.strictObject({ name: criterionNameSchema, weight: weightSchema }))
    .max(maxSuggestedCriteria),
});
export type SuggestedCriteria = z.infer<typeof SuggestedCriteria>;

export const suggestCriteria = {
  method: 'post',
  path: '/comparison/suggestions',
  operationId: 'suggestCriteria',
  summary:
    'Sends the criterion names the comparison screen shows (from the catalog, no case data) to a model and answers other country-level criteria worth weighing when a family chooses where to move, each with a starting weight; nothing is stored. Needs a confirmed account, like the case routes, but no case. 20 per account per day and 3 per minute (429 rate_limited); 502 suggestions_unparsable or suggestions_failed; 503 suggestions_unavailable when no model can be reached; 504 suggestions_timeout',
  body: SuggestCriteriaRequest,
  response: { description: 'The suggested criteria', schema: SuggestedCriteria },
} as const satisfies RouteDefinition<typeof SuggestedCriteria>;

export const comparisonRoutes = {
  getComparison,
  writeComparisonPreferences,
  suggestCriteria,
} as const;
