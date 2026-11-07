import {
  comparisonPreferencesRequestSchema,
  comparisonPreferencesSchema,
  countryCodeSchema,
  criterionIdSchema,
  decimalSchema,
  maxCriterionKeys,
  ownCriterionIdSchema,
  slugSchema,
  sourceSchema,
  weightSchema,
} from '@arca/domain';
import { z } from 'zod';
import { RouteResult } from './case.js';
import type { RouteDefinition } from './index.js';

/*
 * The destination comparison (ADR-0026, #310): one adult's ranking of the countries that have a
 * route, from their own weights and ratings. Like the case routes, it needs a session and a
 * confirmed account (401, 403 account_unconfirmed) and answers 404 not_found outside a case.
 * Preferences are the caller's alone: no other member, and no model, ever reads them.
 */

const weights = { weight: weightSchema, defaultWeight: weightSchema };

export const ComparedCriterion = z.union([
  z.object({
    id: criterionIdSchema,
    kind: z.enum(['indicator', 'category', 'personal']),
    /** The knowledge title; the screen shows its own label for the ID when it has one. */
    title: z.string().max(200),
    ...weights,
  }),
  z.object({
    id: ownCriterionIdSchema,
    kind: z.literal('own'),
    /** The caller's own name for it: case data, never logged. */
    name: z.string().max(60),
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

export const comparisonRoutes = { getComparison, writeComparisonPreferences } as const;
