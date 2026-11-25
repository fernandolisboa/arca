import { createComparisonCatalog } from './comparisons.js';
import { parseComparisons } from './entries.js';
import { countryCodeSchema, suggestedRatingsSchema } from '@arca/domain';
import { z } from 'zod';
import type { Json } from './canonical.js';
import { classificationKinds } from './datasets.js';
import {
  comparisonData,
  countryData,
  datasetFileData,
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

/**
 * The codes of the newest occupations file (ADR-0036): the ISCO-08 unit groups a person may pick
 * for a work period, which the API checks answers against.
 */
export const occupationCodes: readonly string[] = newestCodes(classificationKinds.occupations);

function newestCodes(kind: string): readonly string[] {
  const prefix = `${kind}/${kind}/`;
  const numbers = Object.keys(datasetFiles)
    .filter((key) => key.startsWith(prefix))
    .map((key) => Number(key.slice(prefix.length)));
  if (numbers.length === 0) return [];
  const newest = Math.max(...numbers);
  return z.object({ codes: z.array(z.string()) }).parse(datasetFiles[`${prefix}${String(newest)}`])
    .codes;
}
