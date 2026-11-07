import {
  type ComparisonEntry,
  type ComparisonIdentity,
  type DecisionStates,
  comparisonIdentityKey,
  comparisonStateOf,
} from '@arca/domain';

/**
 * The destination comparison's catalog (ADR-0026): the identity of every version, and a full entry
 * only for an exact identity whose decision state is active, as for route versions.
 */
export interface ComparisonCatalog {
  readonly identities: (comparisonId: string) => readonly ComparisonIdentity[];
  readonly activeEntry: (
    identity: ComparisonIdentity,
    states: DecisionStates,
  ) => ComparisonEntry | undefined;
}

export function createComparisonCatalog(
  entries: ReadonlyMap<string, ComparisonEntry>,
): ComparisonCatalog {
  return {
    identities: (comparisonId) =>
      [...entries.values()]
        .map(({ identity }) => identity)
        .filter((identity) => identity.comparisonId === comparisonId),
    activeEntry: (identity, states) => {
      const entry = entries.get(comparisonIdentityKey(identity));
      return entry !== undefined && comparisonStateOf(entry.identity, states) === 'active'
        ? entry
        : undefined;
    },
  };
}
