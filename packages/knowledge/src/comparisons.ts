import {
  type ComparisonCatalog,
  type ComparisonEntry,
  comparisonIdentityKey,
  comparisonStateOf,
} from '@arca/domain';

/** The destination comparison's one series of versions (ADR-0026), built into the bundle. */
export function createComparisonCatalog(
  entries: ReadonlyMap<string, ComparisonEntry>,
): ComparisonCatalog {
  const identities = [...entries.values()].map(({ identity }) => identity);
  return {
    identities: () => identities,
    activeEntry: (identity, states) => {
      const entry = entries.get(comparisonIdentityKey(identity));
      return entry !== undefined && comparisonStateOf(entry.identity, states) === 'active'
        ? entry
        : undefined;
    },
  };
}
