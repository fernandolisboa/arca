import { type CatalogEntry, identityKey } from '@arca/domain';

export type ReproductionLookup = (
  routeId: string,
  number: number,
  hash: string,
) => CatalogEntry | undefined;

/**
 * Looks an exact version up by route ID, number and content hash, ignoring decision states, so an
 * evaluation of a version later rejected stays reproducible with `evaluateVersion` (spec 0002, R5).
 * Lint allows importing this entry point only in the cases runner and the reproduction path, never
 * where `evaluateRoute` runs.
 */
export function createReproductionLookup(
  entries: ReadonlyMap<string, CatalogEntry>,
): ReproductionLookup {
  return (routeId, number, hash) => entries.get(identityKey({ routeId, number, hash }));
}
