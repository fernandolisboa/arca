import { createRouteCatalog } from './catalog.js';
import { createComparisonCatalog } from './comparisons.js';
import { parseComparisons, parseEntries } from './entries.js';
import { countryCodeSchema } from '@arca/domain';
import { z } from 'zod';
import { catalogData, comparisonData, countryData } from './generated/catalog.js';

const entries = parseEntries(catalogData);

/** The built knowledge catalog. Nothing reads the data directory at runtime (spec 0002, R6). */
export const routeCatalog = createRouteCatalog(entries);

/** The destination comparison's versions (ADR-0026); content only for an active one. */
export const comparisonCatalog = createComparisonCatalog(parseComparisons(comparisonData));

/** Every route the catalog has a version of, in a stable order. */
export const routeIds: readonly string[] = [
  ...new Set([...entries.values()].map(({ identity }) => identity.routeId)),
].sort();

/** The pinned countries and former states, by code; their names come from the client's locale. */
export const pinnedCountries = z
  .strictObject({
    countries: z.array(countryCodeSchema),
    formerCountries: z.array(countryCodeSchema),
  })
  .parse(countryData);

export type PinnedCountries = typeof pinnedCountries;
