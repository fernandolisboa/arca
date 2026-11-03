import { type CalendarDate, firstDate, lastDate } from '../calendar/calendar-date.js';
import type { CurrencyCode } from '../money/currency.js';
import { compareScaled } from '../money/decimal.js';
import type { Scaled } from '../money/decimal.js';
import type { Truth } from './truth.js';

/**
 * What the engine knows about a value: a point, a range or nothing. Ranges over-approximate, so a
 * comparison they decide is never wrong (spec 0002, R4).
 */
export type Value = BooleanValue | NumberValue | DateValueRange | TokenValue | TokenListValue;

export interface BooleanValue {
  readonly type: 'boolean';
  readonly value: Truth;
}

/**
 * An integer, a decimal or, with a currency, an amount in minor units. A missing bound is
 * unbounded on that side.
 */
export interface NumberValue {
  readonly type: 'number';
  readonly currency?: CurrencyCode;
  readonly min?: Scaled;
  readonly max?: Scaled;
}

export interface DateValueRange {
  readonly type: 'date';
  readonly min: CalendarDate;
  readonly max: CalendarDate;
}

/** A country code or a value of a catalog enumeration; absent when unknown. */
export interface TokenValue {
  readonly type: 'token';
  readonly value?: string;
}

/**
 * A list of tokens, such as the citizenships held at a date: those certainly in it, those that
 * may be, and whether nothing else can be.
 */
export interface TokenListValue {
  readonly type: 'tokens';
  readonly definite: readonly string[];
  readonly possible: readonly string[];
  readonly complete: boolean;
}

export function booleanValue(value: Truth): BooleanValue {
  return { type: 'boolean', value };
}

export function integerRange(min: number | undefined, max: number | undefined): NumberValue {
  return {
    type: 'number',
    ...(min === undefined ? {} : { min: { units: BigInt(min), scale: 0 } }),
    ...(max === undefined ? {} : { max: { units: BigInt(max), scale: 0 } }),
  };
}

export function unknownDate(): DateValueRange {
  return { type: 'date', min: firstDate, max: lastDate };
}

export function tokenValue(value: string | undefined): TokenValue {
  return value === undefined ? { type: 'token' } : { type: 'token', value };
}

/** True when the value has a single possible value. */
export function isKnown(value: Value): boolean {
  switch (value.type) {
    case 'boolean':
      return value.value !== 'unknown';
    case 'number':
      return (
        value.min !== undefined &&
        value.max !== undefined &&
        compareScaled(value.min, value.max) === 0
      );
    case 'date':
      return value.min === value.max;
    case 'token':
      return value.value !== undefined;
    case 'tokens':
      return value.complete && value.possible.length === 0;
  }
}
