import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addNumbers,
  compareNumbers,
  maxNumbers,
  minNumbers,
  multiplyNumber,
  subtractNumbers,
} from '../../src/logic/number.js';
import type { ComparisonOperator } from '../../src/logic/truth.js';
import type { NumberValue } from '../../src/logic/value.js';
import { compareScaled, parseDecimal } from '../../src/money/decimal.js';

/** An interval with possibly open ends, and a point inside it. */
const intervalWithPoint = fc
  .record({
    low: fc.integer({ min: -1000, max: 1000 }),
    width: fc.integer({ min: 0, max: 500 }),
    offset: fc.integer({ min: 0, max: 500 }),
    openMin: fc.boolean(),
    openMax: fc.boolean(),
  })
  .map(({ low, width, offset, openMin, openMax }) => {
    const point = low + Math.min(offset, width);
    const value: NumberValue = {
      type: 'number',
      ...(openMin ? {} : { min: { units: BigInt(low), scale: 0 } }),
      ...(openMax ? {} : { max: { units: BigInt(low + width), scale: 0 } }),
    };
    return { value, point: BigInt(point) };
  });

function contains(value: NumberValue, point: bigint, scale = 0): boolean {
  const at = { units: point, scale };
  return (
    (value.min === undefined || compareScaled(value.min, at) <= 0) &&
    (value.max === undefined || compareScaled(at, value.max) <= 0)
  );
}

const operators: ComparisonOperator[] = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'];

function holds(left: bigint, operator: ComparisonOperator, right: bigint): boolean {
  switch (operator) {
    case 'eq':
      return left === right;
    case 'ne':
      return left !== right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
  }
}

describe('interval arithmetic is sound', () => {
  it('add, sub, min and max contain the result of any points inside', () => {
    fc.assert(
      fc.property(intervalWithPoint, intervalWithPoint, (a, b) => {
        expect(contains(addNumbers(a.value, b.value), a.point + b.point)).toBe(true);
        expect(contains(subtractNumbers(a.value, b.value), a.point - b.point)).toBe(true);
        const low = a.point < b.point ? a.point : b.point;
        const high = a.point < b.point ? b.point : a.point;
        expect(contains(minNumbers([a.value, b.value]), low)).toBe(true);
        expect(contains(maxNumbers([a.value, b.value]), high)).toBe(true);
      }),
    );
  });

  it('mul by a decimal contains the scaled point, swapping bounds when negative', () => {
    fc.assert(
      fc.property(intervalWithPoint, fc.integer({ min: -300, max: 300 }), (a, hundredths) => {
        const factor = parseDecimal((hundredths / 100).toFixed(2));
        const result = multiplyNumber(a.value, factor);
        expect(contains(result, a.point * BigInt(hundredths), 2)).toBe(true);
      }),
    );
  });

  it('a decided comparison agrees with every pair of points', () => {
    fc.assert(
      fc.property(
        intervalWithPoint,
        intervalWithPoint,
        fc.constantFrom(...operators),
        (a, b, operator) => {
          const truth = compareNumbers(a.value, operator, b.value);
          if (truth !== 'unknown') expect(truth).toBe(holds(a.point, operator, b.point));
        },
      ),
    );
  });

  it('decides a comparison between two equal points', () => {
    const three: NumberValue = {
      type: 'number',
      min: { units: 30n, scale: 1 },
      max: { units: 3n, scale: 0 },
    };
    expect(compareNumbers(three, 'eq', three)).toBe(true);
    expect(compareNumbers({ type: 'number' }, 'eq', { type: 'number' })).toBe('unknown');
  });

  it('multiplying by zero gives exactly zero, even when unbounded', () => {
    expect(multiplyNumber({ type: 'number' }, parseDecimal('0'))).toEqual({
      type: 'number',
      min: { units: 0n, scale: 0 },
      max: { units: 0n, scale: 0 },
    });
  });
});
