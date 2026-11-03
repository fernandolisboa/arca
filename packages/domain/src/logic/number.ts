import {
  type Decimal,
  type Scaled,
  alignScales,
  compareScaled,
  normalizeScaled,
  scaledDecimal,
} from '../money/decimal.js';
import { type ComparisonOperator, type Interval, type Truth, compareIntervals } from './truth.js';
import type { NumberValue } from './value.js';

/**
 * Interval arithmetic on numbers whose bounds may be open (spec 0002, R4): `add` adds the bounds,
 * `sub` subtracts the opposite bounds, `mul` by a negative decimal swaps them and by zero gives
 * zero, and `min` and `max` apply to each bound.
 */
export function addNumbers(left: NumberValue, right: NumberValue): NumberValue {
  return number(
    left,
    both(left.min, right.min, addScaled),
    both(left.max, right.max, addScaled),
    right,
  );
}

export function subtractNumbers(left: NumberValue, right: NumberValue): NumberValue {
  return number(
    left,
    both(left.min, right.max, subtractScaled),
    both(left.max, right.min, subtractScaled),
    right,
  );
}

export function multiplyNumber(value: NumberValue, factor: Decimal): NumberValue {
  const by = scaledDecimal(factor);
  if (by.units === 0n) {
    const zero = { units: 0n, scale: 0 };
    return number(value, zero, zero);
  }
  const times = (bound: Scaled | undefined): Scaled | undefined =>
    bound === undefined
      ? undefined
      : normalizeScaled({ units: bound.units * by.units, scale: bound.scale + by.scale });
  return by.units > 0n
    ? number(value, times(value.min), times(value.max))
    : number(value, times(value.max), times(value.min));
}

export function minNumbers(values: readonly NumberValue[]): NumberValue {
  return extreme(values, -1);
}

export function maxNumbers(values: readonly NumberValue[]): NumberValue {
  return extreme(values, 1);
}

export function compareNumbers(
  left: NumberValue,
  operator: ComparisonOperator,
  right: NumberValue,
): Truth {
  return compareIntervals(extended(left), operator, extended(right), compareExtended);
}

type Extended = Scaled | 'below' | 'above';

function extended(value: NumberValue): Interval<Extended> {
  return { min: value.min ?? 'below', max: value.max ?? 'above' };
}

function compareExtended(left: Extended, right: Extended): number {
  const rank = (bound: Extended): number => (bound === 'below' ? -1 : bound === 'above' ? 1 : 0);
  if (typeof left === 'string' || typeof right === 'string') {
    const difference = rank(left) - rank(right);
    // Two open ends on the same side are never equal: neither bound is a value.
    return difference === 0 ? (left === 'below' ? -1 : 1) : difference;
  }
  return compareScaled(left, right);
}

function extreme(values: readonly NumberValue[], direction: 1 | -1): NumberValue {
  const [first, ...rest] = values;
  if (first === undefined) throw new RangeError('No operands');
  return rest.reduce((result, value) => {
    const pick = (
      a: Scaled | undefined,
      b: Scaled | undefined,
      openWins: boolean,
    ): Scaled | undefined => {
      if (a === undefined || b === undefined) return openWins ? undefined : (a ?? b);
      return compareScaled(a, b) * direction >= 0 ? a : b;
    };
    // An open lower bound is below everything: it wins `min` and loses `max`; the opposite holds
    // for an open upper bound.
    return number(
      result,
      pick(result.min, value.min, direction === -1),
      pick(result.max, value.max, direction === 1),
      value,
    );
  }, first);
}

function both(
  left: Scaled | undefined,
  right: Scaled | undefined,
  operation: (a: Scaled, b: Scaled) => Scaled,
): Scaled | undefined {
  return left === undefined || right === undefined ? undefined : operation(left, right);
}

function addScaled(left: Scaled, right: Scaled): Scaled {
  const [a, b, scale] = alignScales(left, right);
  return normalizeScaled({ units: a + b, scale });
}

function subtractScaled(left: Scaled, right: Scaled): Scaled {
  const [a, b, scale] = alignScales(left, right);
  return normalizeScaled({ units: a - b, scale });
}

function number(
  like: NumberValue,
  min: Scaled | undefined,
  max: Scaled | undefined,
  other?: NumberValue,
): NumberValue {
  const currency = like.currency ?? other?.currency;
  return {
    type: 'number',
    ...(currency === undefined ? {} : { currency }),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };
}
