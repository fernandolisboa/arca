import { describe, expect, it } from 'vitest';
import {
  type ComparisonIdentity,
  comparisonIdentityKey,
  selectComparisonVersion,
} from '../../src/comparison/select.js';
import { type DecisionState, identityKey } from '../../src/rules/catalog.js';

describe('comparison version selection', () => {
  const version = (number: number): ComparisonIdentity => ({
    comparisonId: 'destinations',
    number,
    hash: String(number).repeat(64),
  });
  const states = (decided: readonly (readonly [number, DecisionState])[]) =>
    new Map(decided.map(([number, state]) => [comparisonIdentityKey(version(number)), state]));

  it.each<[string, readonly (readonly [number, DecisionState])[], number | undefined, boolean]>([
    ['nothing decided', [], undefined, true],
    [
      'the newest active wins',
      [
        [1, 'active'],
        [2, 'active'],
      ],
      2,
      false,
    ],
    ['a newer proposed one is pending, not used', [[1, 'active']], 1, true],
    [
      'a rejected newer one is skipped for good',
      [
        [1, 'active'],
        [2, 'rejected'],
      ],
      1,
      false,
    ],
    ['an older proposed one is not pending', [[2, 'active']], 2, false],
    [
      'everything rejected',
      [
        [1, 'rejected'],
        [2, 'rejected'],
      ],
      undefined,
      false,
    ],
  ])('%s', (_name, decided, active, pendingNewer) => {
    const selection = selectComparisonVersion([version(1), version(2)], states(decided));
    expect(selection.active?.number).toBe(active);
    expect(selection.pendingNewer).toBe(pendingNewer);
  });

  it('never shares a key with a route version', () => {
    const identity = version(1);
    expect(comparisonIdentityKey(identity)).not.toBe(
      identityKey({ routeId: identity.comparisonId, number: 1, hash: identity.hash }),
    );
  });
});
