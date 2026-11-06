import {
  type DecisionState,
  type DecisionStates,
  type VersionIdentity,
  identityKey,
} from './catalog.js';

export type DecisionKind = 'activate' | 'reject';

/** A stored decision on one version identity, with whether its approver and assertion check out. */
export interface CheckedDecision {
  readonly kind: DecisionKind;
  readonly identity: Pick<VersionIdentity, 'routeId' | 'number' | 'hash'>;
  readonly verified: boolean;
}

/**
 * Each decided identity's state (ADR-0022): rejected if any rejection counts, else active if a
 * verified activation counts. A rejection counts even unverified, so a fault or a forged row can
 * only take a version out of use; an unverified activation counts for nothing.
 */
export function decisionStates(decisions: readonly CheckedDecision[]): DecisionStates {
  const states = new Map<string, DecisionState>();
  for (const { kind, identity, verified } of decisions) {
    const key = identityKey(identity);
    if (kind === 'reject') states.set(key, 'rejected');
    else if (verified && states.get(key) !== 'rejected') states.set(key, 'active');
  }
  return states;
}
