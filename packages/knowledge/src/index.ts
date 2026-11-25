import { createComparisonCatalog } from './comparisons.js';
import { parseComparisons } from './entries.js';
import { countryCodeSchema, suggestedRatingsSchema } from '@arca/domain';
import { z } from 'zod';
import type { Json } from './canonical.js';
import {
  comparisonData,
  countryData,
  datasetFileData,
  ruleTextData,
  suggestedRatingData,
} from './generated/runtime.js';
import { shippedRuleTextsSchema } from './rule-texts.js';

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

export { type RuleTexts, type Sha256, createRuleTexts } from './rule-texts.js';

/** Route version titles in the screen's language, keyed by their English's hash (ADR-0037). */
export const shippedRuleTexts = shippedRuleTextsSchema.parse(ruleTextData);

/** The pinned countries and former states, by code; their names come from the client's locale. */
export const pinnedCountries = z
  .strictObject({
    countries: z.array(countryCodeSchema),
    formerCountries: z.array(countryCodeSchema),
  })
  .parse(countryData);

export type PinnedCountries = typeof pinnedCountries;

/**
 * The dataset files (countries, former countries, occupations and study fields), keyed
 * `<kind>/<id>/<number>`: they stay in the repository (ADR-0031), and a route version's or country
 * set's hash covers the ones it pins.
 */
export const datasetFiles: Readonly<Record<string, Json>> = z
  .record(z.string(), z.json())
  .parse(datasetFileData);
