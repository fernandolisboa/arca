import { type ComparisonIdentity, comparisonIdentityKey } from '../comparison/select.js';
import {
  type DecisionState,
  type DecisionStates,
  type VersionIdentity,
  identityKey,
} from './catalog.js';

export type DecisionKind = 'activate' | 'reject';

/** What a decision is about (ADR-0026): a route version or a comparison version. */
export type DecisionSubject = 'route' | 'comparison';

/** A version identity with the subject kind it belongs to, so each kind keeps its own identity. */
export type DecidedVersion =
  | {
      readonly subject: 'route';
      readonly identity: Pick<VersionIdentity, 'routeId' | 'number' | 'hash'>;
    }
  | { readonly subject: 'comparison'; readonly identity: ComparisonIdentity };

/**
 * A stored decision on one version identity, with whether its approver and assertion check out.
 * Each subject kind carries its own identity, so a comparison ID never lands in a route slot.
 */
export type CheckedDecision = DecidedVersion & {
  readonly kind: DecisionKind;
  readonly verified: boolean;
};

/** The key of a decided version in `DecisionStates`, by its subject kind. */
export function decidedKey(decision: DecidedVersion): string {
  return decision.subject === 'route'
    ? identityKey(decision.identity)
    : comparisonIdentityKey(decision.identity);
}

/**
 * Each decided identity's state (ADR-0022): rejected if any rejection counts, else active if a
 * verified activation counts. A rejection counts even unverified, so a fault or a forged row can
 * only take a version out of use; an unverified activation counts for nothing. Route and
 * comparison versions have keys of different shapes, so a decision on one never counts for the
 * other (ADR-0026).
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
