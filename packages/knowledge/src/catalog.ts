import {
  type CatalogEntry,
  type RouteCatalog,
  type VersionIdentity,
  identityKey,
  stateOf,
} from '@arca/domain';

/**
 * The engine's catalog (spec 0002, R5): identities of every version, and a full entry only for an
 * exact identity whose decision state is active.
 */
export function createRouteCatalog(entries: ReadonlyMap<string, CatalogEntry>): RouteCatalog {
  const byRoute = new Map<string, VersionIdentity[]>();
  for (const { identity } of entries.values()) {
    byRoute.set(identity.routeId, [...(byRoute.get(identity.routeId) ?? []), identity]);
  }
  return {
    identities: (routeId) => byRoute.get(routeId) ?? [],
    activeEntry: (identity, states) => {
      const entry = entries.get(identityKey(identity));
      return entry !== undefined && stateOf(entry.identity, states) === 'active'
        ? entry
        : undefined;
    },
  };
}
