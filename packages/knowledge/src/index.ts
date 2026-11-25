import { createComparisonCatalog } from './comparisons.js';
import { parseComparisons } from './entries.js';
import {
  countryCodeSchema,
  departureChecklistViews,
  departureChecklistsSchema,
  suggestedRatingsSchema,
} from '@arca/domain';
import { z } from 'zod';
import type { Json } from './canonical.js';
import {
  comparisonData,
  countryData,
  countryFileData,
  departureChecklistData,
  suggestedRatingData,
} from './generated/runtime.js';

export { createRouteCatalog } from './catalog.js';
export {
  type PinnedFileRow,
  type VerifiedOfficialDomainList,
  type RouteVersionRow,
  type RuleData,
  type RuleEngineData,
  type RuleRowReading,
  type RuleRows,
  casesHashOf,
  officialDomainListHash,
  refusedRows,
  routeVersionContentHash,
  verifiedRouteVersion,
  type VerifiedRouteVersion,
  ruleDataFromRows,
  ruleEngineData,
  versionCasesHash,
  approvedOfficialDomainLists,
  pinKey,
  verifiedOfficialDomainLists,
} from './rule-rows.js';
export { type Json, canonicalize } from './canonical.js';
export { type CasesFile, type RuleCase, casesFileSchema } from './cases.js';
export { runVersionCases } from './case-run.js';
export {
  type CheckedProposal,
  type ProposalTarget,
  type RefusedProposal,
  checkProposal,
  maxProposalProblems,
} from './proposal.js';

/** The destination comparison's versions (ADR-0026); content only for an active one. */
export const comparisonCatalog = createComparisonCatalog(parseComparisons(comparisonData));

/** The stars the comparison suggests per country (ADR-0035), or null when the repository has none. */
export const suggestedRatings =
  suggestedRatingData === null ? null : suggestedRatingsSchema.parse(suggestedRatingData);

const departureFile =
  departureChecklistData === null ? null : departureChecklistsSchema.parse(departureChecklistData);

/** What to do when leaving a country, per country, with each item's sources (ADR-0037). */
export const departureChecklists =
  departureFile === null ? [] : departureChecklistViews(departureFile);

/** The SHA-256 of the catalog wording the departure file's sources were checked against. */
export const departureWordingSha256 = departureFile?.wordingSha256 ?? null;

/** The pinned countries and former states, by code; their names come from the client's locale. */
export const pinnedCountries = z
  .strictObject({
    countries: z.array(countryCodeSchema),
    formerCountries: z.array(countryCodeSchema),
  })
  .parse(countryData);

export type PinnedCountries = typeof pinnedCountries;

/**
 * The countries and former-countries files, keyed `<kind>/<id>/<number>`: they stay in the
 * repository (ADR-0031), and a route version's or country set's hash covers the ones it pins.
 */
export const countryFiles: Readonly<Record<string, Json>> = z
  .record(z.string(), z.json())
  .parse(countryFileData);
