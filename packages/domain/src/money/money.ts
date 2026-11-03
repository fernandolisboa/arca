import { z } from 'zod';
import { type CurrencyCode, currencyCodeSchema } from './currency.js';
import {
  type Decimal,
  type Scaled,
  alignScales,
  normalizeScaled,
  powerOfTen,
  scaledDecimal,
} from './decimal.js';

/** An amount in integer minor units (cents for USD, yen for JPY) of an ISO 4217 currency. */
export const moneySchema = z.strictObject({
  amount: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  currency: currencyCodeSchema,
});

export type Money = z.infer<typeof moneySchema>;

/**
 * An exact amount, `units / 10^scale` minor units, as a multiplication or conversion leaves it.
 * Comparisons use exact amounts; only a reported amount is rounded, once (spec 0002, R2).
 */
export interface ExactAmount extends Scaled {
  readonly currency: CurrencyCode;
}

export function money(amount: number, currency: CurrencyCode): Money {
  return moneySchema.parse({ amount, currency });
}

export function toExact(value: Money): ExactAmount {
  return { units: BigInt(value.amount), scale: 0, currency: value.currency };
}

export function addExact(left: ExactAmount, right: ExactAmount): ExactAmount {
  const [a, b, scale] = alignScales(left, right);
  return withCurrency(sameCurrency(left, right), { units: a + b, scale });
}

export function subtractExact(left: ExactAmount, right: ExactAmount): ExactAmount {
  const [a, b, scale] = alignScales(left, right);
  return withCurrency(sameCurrency(left, right), { units: a - b, scale });
}

export function multiplyExact(amount: ExactAmount, factor: Decimal): ExactAmount {
  const multiplier = scaledDecimal(factor);
  return withCurrency(amount.currency, {
    units: amount.units * multiplier.units,
    scale: amount.scale + multiplier.scale,
  });
}

/** The sum of exact amounts in one currency; zero for none. */
export function sumExact(amounts: readonly ExactAmount[], currency: CurrencyCode): ExactAmount {
  return amounts.reduce(addExact, { units: 0n, scale: 0, currency });
}

export function compareExact(left: ExactAmount, right: ExactAmount): number {
  sameCurrency(left, right);
  const [a, b] = alignScales(left, right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function minExact(left: ExactAmount, right: ExactAmount): ExactAmount {
  return compareExact(left, right) <= 0 ? left : right;
}

export function maxExact(left: ExactAmount, right: ExactAmount): ExactAmount {
  return compareExact(left, right) >= 0 ? left : right;
}

/** Rounds to whole minor units, half to even. Used once, on a reported amount. */
export function roundHalfEven(amount: ExactAmount): Money {
  const divisor = powerOfTen(amount.scale);
  const negative = amount.units < 0n;
  const magnitude = negative ? -amount.units : amount.units;
  const quotient = magnitude / divisor;
  const twiceRemainder = (magnitude % divisor) * 2n;
  const roundsUp = twiceRemainder > divisor || (twiceRemainder === divisor && quotient % 2n === 1n);
  const rounded = roundsUp ? quotient + 1n : quotient;
  const units = negative ? -rounded : rounded;
  if (units > BigInt(Number.MAX_SAFE_INTEGER) || units < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Amount is outside the safe integer range');
  }
  return { amount: Number(units), currency: amount.currency };
}

function sameCurrency(left: ExactAmount, right: ExactAmount): CurrencyCode {
  if (left.currency !== right.currency) {
    throw new RangeError('Money operands must share a currency; convert one first');
  }
  return left.currency;
}

function withCurrency(currency: CurrencyCode, value: Scaled): ExactAmount {
  return { ...normalizeScaled(value), currency };
}
