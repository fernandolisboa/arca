import { type ComparisonIdentity, comparisonIdentityKey } from '../comparison/select.js';
import {
  type DecisionState,
  type DecisionStates,
  type VersionIdentity,
  identityKey,
} from './catalog.js';

export type DecisionKind = 'activate' | 'reject';

/**
 * What a decision is about: a route version, a comparison version (ADR-0026) or an official-domain
 * list version a new-route request proposed (ADR-0031).
 */
export type DecisionSubject = 'route' | 'comparison' | 'official_domains';

/** An official-domain list version's identity: its ID, number and content hash. */
export interface OfficialDomainsIdentity {
  readonly listId: string;
  readonly number: number;
  readonly hash: string;
}

/** The key of an official-domain list version in `DecisionStates`. */
export const officialDomainsKey = ({ listId, number, hash }: OfficialDomainsIdentity): string =>
  `official-domains/${listId}/${String(number)}/${hash}`;

/** A version identity with the subject kind it belongs to, so each kind keeps its own identity. */
export type DecidedVersion =
  | {
      readonly subject: 'route';
      readonly identity: Pick<VersionIdentity, 'routeId' | 'number' | 'hash'>;
    }
  | { readonly subject: 'comparison'; readonly identity: ComparisonIdentity }
  | { readonly subject: 'official_domains'; readonly identity: OfficialDomainsIdentity };

/**
 * A stored decision on one version identity, with whether its admin and assertion check out.
 * Each subject kind carries its own identity, so a comparison ID never lands in a route slot.
 */
export type CheckedDecision = DecidedVersion & {
  readonly kind: DecisionKind;
  readonly verified: boolean;
};

/** The key of a decided version in `DecisionStates`, by its subject kind. */
export function decidedKey(decision: DecidedVersion): string {
  switch (decision.subject) {
    case 'route':
      return identityKey(decision.identity);
    case 'comparison':
      return comparisonIdentityKey(decision.identity);
    case 'official_domains':
      return officialDomainsKey(decision.identity);
  }
}

/**
 * Each decided identity's state (ADR-0022): rejected if any rejection counts, else active if a
 * verified activation counts. A rejection counts even unverified, so a fault or a forged row can
 * only take a version out of use; an unverified activation counts for nothing. Each subject kind
 * has keys of its own shape, so a decision on one never counts for another (ADR-0026).
 */
export function decisionStates(decisions: readonly CheckedDecision[]): DecisionStates {
  const states = new Map<string, DecisionState>();
  for (const decision of decisions) {
    const key = decidedKey(decision);
    if (decision.kind === 'reject') states.set(key, 'rejected');
    else if (decision.verified && states.get(key) !== 'rejected') states.set(key, 'active');
  }
  return states;
}
