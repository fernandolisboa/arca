import { describe, expect, it } from 'vitest';
import { formatScaled, powerOfTen, roundedDecimal } from '../../src/money/decimal.js';

describe('powerOfTen', () => {
  it.each([-1, 1001, 0.5, Number.NaN])('refuses the exponent %d', (exponent) => {
    expect(() => powerOfTen(exponent)).toThrow(RangeError);
  });

  it('computes small powers', () => {
    expect(powerOfTen(0)).toBe(1n);
    expect(powerOfTen(3)).toBe(1000n);
  });
});

describe('formatScaled', () => {
  it.each<[bigint, number, string]>([
    [1500n, 3, '1.5'],
    [-150n, 2, '-1.5'],
    [7n, 0, '7'],
    [5n, 2, '0.05'],
    [0n, 2, '0'],
  ])('%d at scale %d is %s', (units, scale, expected) => {
    expect(formatScaled({ units, scale })).toBe(expected);
  });
});

describe('roundedDecimal', () => {
  it.each<[bigint, bigint, number, string]>([
    [1n, 3n, 1, '0.3'],
    [2n, 3n, 2, '0.67'],
    [125n, 1000n, 2, '0.12'],
    [135n, 1000n, 2, '0.14'],
    [10n, 1n, 1, '10'],
  ])('%d / %d to %d places is %s', (n, d, places, expected) => {
    expect(roundedDecimal(n, d, places)).toBe(expected);
  });
});
