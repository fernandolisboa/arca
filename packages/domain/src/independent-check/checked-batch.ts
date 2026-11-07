import type { DecisionState } from '../rules/catalog.js';
import { type ListedCheckStatus, versionKey } from './reports.js';

/** A route version as the activation screen showed it: the identity an admin tapped on. */
export interface ShownVersion {
  readonly routeId: string;
  readonly number: number;
  readonly hash: string;
}

/** A bundled route version as the server reads it now, with its state and check status. */
export interface BatchListedVersion extends ShownVersion {
  readonly state: DecisionState;
  readonly check: ListedCheckStatus;
}

/**
 * Why a version shown as checked was not activated with the others (ADR-0027). `not_admin` comes
 * from the decision itself, when the role is taken away while the batch runs.
 */
export const checkedBatchSkips = [
  'not_found',
  'changed',
  'rejected',
  'already_active',
  'flagged',
  'not_checked',
  'not_admin',
] as const;
export type CheckedBatchSkip = (typeof checkedBatchSkips)[number];

export interface SkippedVersion {
  readonly routeId: string;
  readonly number: number;
  readonly reason: CheckedBatchSkip;
}

function skipReason(
  shown: ShownVersion,
  listed: BatchListedVersion | undefined,
): CheckedBatchSkip | undefined {
  if (listed === undefined) return 'not_found';
  if (listed.hash !== shown.hash) return 'changed';
  if (listed.state === 'rejected') return 'rejected';
  if (listed.state === 'active') return 'already_active';
  if (listed.check === 'flagged') return 'flagged';
  return listed.check === 'checked' ? undefined : 'not_checked';
}

/**
 * Sorts the versions an admin saw as checked into those to activate now and those to skip, with
 * a reason each (ADR-0027): only a version still proposed, with the hash shown and a clean current
 * report, is activated. The order shown is kept, and a version shown twice counts once.
 */
export function checkedBatch(
  shown: readonly ShownVersion[],
  listed: readonly BatchListedVersion[],
): { readonly activate: ShownVersion[]; readonly skipped: SkippedVersion[] } {
  const byKey = new Map(listed.map((version) => [versionKey(version), version]));
  const seen = new Set<string>();
  const activate: ShownVersion[] = [];
  const skipped: SkippedVersion[] = [];
  for (const version of shown) {
    const key = versionKey(version);
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = skipReason(version, byKey.get(key));
    if (reason === undefined) activate.push(version);
    else skipped.push({ routeId: version.routeId, number: version.number, reason });
  }
  return { activate, skipped };
}
