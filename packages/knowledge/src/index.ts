import { createComparisonCatalog } from './comparisons.js';
import { parseComparisons } from './entries.js';
import { createGuideLookup } from './guides.js';
import { countryCodeSchema } from '@arca/domain';
import { z } from 'zod';
import type { Json } from './canonical.js';
import { comparisonData, countryData, countryFileData, guideData } from './generated/runtime.js';

export { createRouteCatalog } from './catalog.js';
export {
  type PinnedFileRow,
  type RouteVersionRow,
  type RuleData,
  type RuleEngineData,
  type RuleRowReading,
  type RuleRows,
  refusedRows,
  routeVersionContentHash,
  ruleDataFromRows,
  ruleEngineData,
} from './rule-rows.js';
export { type Json, canonicalize } from './canonical.js';
export { type CasesFile, type RuleCase, casesFileSchema } from './cases.js';
export { runVersionCases } from './case-run.js';
export {
  type CheckedProposal,
  type RefusedProposal,
  checkProposal,
  maxProposalProblems,
} from './proposal.js';

/** The destination comparison's versions (ADR-0026); content only for an active one. */
export const comparisonCatalog = createComparisonCatalog(parseComparisons(comparisonData));

/** A country's current guide, the specialist knowledge the independent check loads (ADR-0027). */
export const countryGuide = createGuideLookup(guideData);

export type { CountryGuideEntry, CountryGuideLookup } from './guides.js';

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
