import { describe, expect, it } from 'vitest';
import { type Value, integerRange, isKnown, unknownDate } from '../../src/logic/value.js';

describe('isKnown', () => {
  it.each<[string, Value, boolean]>([
    ['a known boolean', { type: 'boolean', value: false }, true],
    ['an unknown boolean', { type: 'boolean', value: 'unknown' }, false],
    ['a point', integerRange(3, 3), true],
    ['a range', integerRange(3, 4), false],
    ['an open range', integerRange(3, undefined), false],
    [
      'the same number at two scales',
      { type: 'number', min: { units: 30n, scale: 1 }, max: { units: 3n, scale: 0 } },
      true,
    ],
    ['an unknown date', unknownDate(), false],
    ['an unknown token', { type: 'token' }, false],
    ['a known token', { type: 'token', value: 'QM' }, true],
    ['a complete list', { type: 'tokens', definite: ['QM'], possible: [], complete: true }, true],
    [
      'a list with possible tokens',
      { type: 'tokens', definite: [], possible: ['QM'], complete: true },
      false,
    ],
    ['an incomplete list', { type: 'tokens', definite: [], possible: [], complete: false }, false],
  ])('%s', (_label, value, expected) => {
    expect(isKnown(value)).toBe(expected);
  });
});
