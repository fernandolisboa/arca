import { createRouteCatalog } from './catalog.js';
import { parseEntries } from './entries.js';
import { countryCodeSchema } from '@arca/domain';
import { z } from 'zod';
import { catalogData, countryData } from './generated/catalog.js';

const entries = parseEntries(catalogData);

/** The built knowledge catalog. Nothing reads the data directory at runtime (spec 0002, R6). */
export const routeCatalog = createRouteCatalog(entries);

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
