import type { DecisionState, DecisionStates } from '../rules/catalog.js';
import type { ComparisonVersion, CountryIndicator } from './schema.js';

/** What selection may read about any comparison version, proposed ones included. */
export interface ComparisonIdentity {
  readonly comparisonId: string;
  readonly number: number;
  /** The content hash over the version and every indicator it pins (ADR-0026). */
  readonly hash: string;
}

/** A validated comparison version with exactly the indicators it pins. */
export interface ComparisonEntry {
  readonly identity: ComparisonIdentity;
  readonly version: ComparisonVersion;
  readonly indicators: readonly CountryIndicator[];
}

/**
 * The destination comparison's view of the knowledge catalog (ADR-0026): the identity of every
 * version of its one series, and a full entry only for an exact identity whose decision state is
 * active, as `RouteCatalog` does for route versions.
 */
export interface ComparisonCatalog {
  readonly identities: () => readonly ComparisonIdentity[];
  readonly activeEntry: (
    identity: ComparisonIdentity,
    states: DecisionStates,
  ) => ComparisonEntry | undefined;
}

/**
 * The key of a comparison version in `DecisionStates`. It has four segments where a route's has
 * three, so a comparison decision can never count for a route version, nor the reverse.
 */
export function comparisonIdentityKey(identity: ComparisonIdentity): string {
  return `comparison/${identity.comparisonId}/${String(identity.number)}/${identity.hash}`;
}

export function comparisonStateOf(
  identity: ComparisonIdentity,
  states: DecisionStates,
): DecisionState {
  return states.get(comparisonIdentityKey(identity)) ?? 'proposed';
}

export interface ComparisonSelection {
  /** The highest-numbered active version, if any. */
  readonly active?: ComparisonIdentity;
  /** Whether a higher-numbered version waits for a decision: its identity read, never its content. */
  readonly pendingNewer: boolean;
}

/** Picks the comparison version to use (ADR-0026): no effective dates, the newest active one wins. */
export function selectComparisonVersion(
  identities: readonly ComparisonIdentity[],
  states: DecisionStates,
): ComparisonSelection {
  if (new Set(identities.map((identity) => identity.number)).size !== identities.length) {
    throw new RangeError('Two versions share a number');
  }
  if (new Set(identities.map((identity) => identity.comparisonId)).size > 1) {
    throw new RangeError('Versions of more than one comparison');
  }
  const newestFirst = [...identities].sort((left, right) => right.number - left.number);
  const active = newestFirst.find((identity) => comparisonStateOf(identity, states) === 'active');
  const pendingNewer = newestFirst.some(
    (identity) =>
      comparisonStateOf(identity, states) === 'proposed' &&
      (active === undefined || identity.number > active.number),
  );
  return active === undefined ? { pendingNewer } : { active, pendingNewer };
}
