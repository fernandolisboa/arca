import { type CatalogEntry, identityKey } from '@arca/domain';
import { catalogEntries } from './entries.js';

export type ReproductionLookup = (
  routeId: string,
  number: number,
  hash: string,
) => CatalogEntry | undefined;

/** Looks an exact version up by route ID, number and content hash, ignoring decision states. */
export function createReproductionLookup(
  entries: ReadonlyMap<string, CatalogEntry>,
): ReproductionLookup {
  return (routeId, number, hash) => entries.get(identityKey({ routeId, number, hash }));
}

/**
 * The entry of an exact version, whatever its decision state, so an evaluation of a version later
 * rejected stays reproducible with `evaluateVersion` (spec 0002, R5). Lint allows importing this
 * entry point only in the cases runner and the reproduction path, never where `evaluateRoute` runs.
 */
export const reproductionEntry = createReproductionLookup(catalogEntries);
