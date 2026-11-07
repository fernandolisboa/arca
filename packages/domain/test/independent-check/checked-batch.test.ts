import { describe, expect, it } from 'vitest';
import {
  type BatchListedVersion,
  type ShownVersion,
  checkedBatch,
} from '../../src/independent-check/checked-batch.js';

/** Synthetic route versions only. */
const shown = (number: number, hash = 'a'.repeat(64)): ShownVersion => ({
  routeId: 'qm-sample',
  number,
  hash,
});

const listed = (
  number: number,
  patch: Partial<Pick<BatchListedVersion, 'state' | 'check' | 'hash'>> = {},
): BatchListedVersion => ({ ...shown(number), state: 'proposed', check: 'checked', ...patch });

describe('checkedBatch (ADR-0027)', () => {
  it.each([
    ['a checked proposed version', listed(1), 'activate'],
    ['a version the catalog does not hold', undefined, 'not_found'],
    ['a version whose hash changed', listed(1, { hash: 'b'.repeat(64) }), 'changed'],
    ['a rejected version', listed(1, { state: 'rejected' }), 'rejected'],
    ['an active version', listed(1, { state: 'active' }), 'already_active'],
    ['a flagged version', listed(1, { check: 'flagged' }), 'flagged'],
    ['a stale report', listed(1, { check: 'stale' }), 'not_checked'],
    ['a running check', listed(1, { check: 'running' }), 'not_checked'],
    ['no report', listed(1, { check: 'none' }), 'not_checked'],
  ] as const)('sorts %s', (_, version, expected) => {
    const batch = checkedBatch([shown(1)], version === undefined ? [] : [version]);
    if (expected === 'activate') {
      expect(batch).toEqual({ activate: [shown(1)], skipped: [] });
    } else {
      expect(batch).toEqual({
        activate: [],
        skipped: [{ routeId: 'qm-sample', number: 1, reason: expected }],
      });
    }
  });

  it('names a hash change before any state, so a stale screen never reads as decided', () => {
    const batch = checkedBatch(
      [shown(1)],
      [listed(1, { hash: 'b'.repeat(64), state: 'rejected', check: 'flagged' })],
    );
    expect(batch.skipped).toEqual([{ routeId: 'qm-sample', number: 1, reason: 'changed' }]);
  });

  it('keeps the order shown and takes each version once', () => {
    const batch = checkedBatch(
      [shown(3), shown(1), shown(2), shown(3)],
      [listed(1), listed(2, { check: 'flagged' }), listed(3)],
    );
    expect(batch).toEqual({
      activate: [shown(3), shown(1)],
      skipped: [{ routeId: 'qm-sample', number: 2, reason: 'flagged' }],
    });
  });

  it('activates only what was shown, never another checked version', () => {
    expect(checkedBatch([shown(2)], [listed(1), listed(2)]).activate).toEqual([shown(2)]);
  });
});
