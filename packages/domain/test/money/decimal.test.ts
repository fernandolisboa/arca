import { describe, expect, it } from 'vitest';
import { powerOfTen } from '../../src/money/decimal.js';

describe('powerOfTen', () => {
  it.each([-1, 1001, 0.5, Number.NaN])('refuses the exponent %d', (exponent) => {
    expect(() => powerOfTen(exponent)).toThrow(RangeError);
  });

  it('computes small powers', () => {
    expect(powerOfTen(0)).toBe(1n);
    expect(powerOfTen(3)).toBe(1000n);
  });
});
