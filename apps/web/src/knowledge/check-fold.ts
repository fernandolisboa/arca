import type { VersionCheck } from '@arca/api-contract/client';

export interface CheckFold {
  /** Changes once, when the check first loads, so the panel starts over with the right default. */
  readonly key: 'loading' | 'loaded';
  readonly defaultOpen: boolean;
}

/**
 * How the check report panel starts: folded only when the version already reads as checked when
 * the panel loads. Anything short of clean stays open, and a check that finishes during the visit
 * keeps the panel as it was, so its result is not hidden as it arrives.
 */
export function checkFold(pending: boolean, status: VersionCheck['status'] | undefined): CheckFold {
  return { key: pending ? 'loading' : 'loaded', defaultOpen: status !== 'checked' };
}
