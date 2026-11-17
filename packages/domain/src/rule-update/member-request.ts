/**
 * A member's update request (ADR-0031, #462) as the member sees it: received until an admin
 * releases or declines it; released while the update request it started runs, or once that ended
 * with no proposal; finished once it ended with one; declined by an admin.
 */
export const memberRequestStates = ['received', 'released', 'finished', 'declined'] as const;
export type MemberRequestState = (typeof memberRequestStates)[number];

/** How the update request a release started stands. */
export const releasedRuns = ['running', 'finished', 'failed', 'stalled'] as const;
export type ReleasedRun = (typeof releasedRuns)[number];

/** A member's request, from its stored release and decline. */
export interface MemberRequestFacts {
  readonly declined: boolean;
  /** The run its release started, or null when no admin released it. */
  readonly run: ReleasedRun | null;
}

export function memberRequestState({ declined, run }: MemberRequestFacts): MemberRequestState {
  if (declined) return 'declined';
  if (run === null) return 'received';
  return run === 'finished' ? 'finished' : 'released';
}

/** Whether an admin may still release it: nobody released or declined it. */
export const releasable = ({ declined, run }: MemberRequestFacts): boolean =>
  !declined && run === null;

/**
 * Whether an admin may still decline it: open, or released and its run ended with no proposal,
 * so a member's request never stays released for good.
 */
export const declinable = ({ declined, run }: MemberRequestFacts): boolean =>
  !declined && (run === null || run === 'failed' || run === 'stalled');
