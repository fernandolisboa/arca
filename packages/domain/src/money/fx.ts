import { z } from 'zod';
import {
  type CalendarDate,
  calendarDateSchema,
  compareDates,
  firstDate,
  tryAddDays,
} from '../calendar/calendar-date.js';
import { type CurrencyCode, currencyCodeSchema, minorUnitExponent } from './currency.js';
import {
  decimalSchema,
  isPositiveDecimal,
  normalizeScaled,
  powerOfTen,
  scaledDecimal,
} from './decimal.js';
import type { ExactAmount } from './money.js';

/** A rate is usable for at most this many days after its date. */
export const maxRateAgeDays = 7;

const fxRateSchema = z
  .strictObject({
    from: currencyCodeSchema,
    to: currencyCodeSchema,
    /** Units of `to` per unit of `from`. */
    rate: decimalSchema.refine(isPositiveDecimal, { message: 'A rate is positive' }),
    date: calendarDateSchema,
    source: z.string().min(1).max(200),
  })
  .refine((rate) => rate.from !== rate.to, { message: 'A rate converts between two currencies' });

/**
 * Rates the caller supplies, with their date and source. Pairs are directional: no inversion and
 * no cross rates. The engine never fetches a rate (spec 0002, R2).
 */
export const fxTableSchema = z
  .strictObject({ rates: z.array(fxRateSchema).max(10_000) })
  .refine((table) => new Set(table.rates.map(rateKey)).size === table.rates.length, {
    message: 'Two rates for the same pair and date',
  });

export type FxRate = z.infer<typeof fxRateSchema>;
export type FxTable = z.infer<typeof fxTableSchema>;

export interface CurrencyPair {
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
}

export type Conversion =
  | { readonly kind: 'converted'; readonly amount: ExactAmount; readonly rate?: FxRate }
  | { readonly kind: 'missing_rate'; readonly pair: CurrencyPair };

/** The latest rate for the pair dated on or before `factsAsOf`, and at most 7 days older. */
export function findRate(
  table: FxTable,
  pair: CurrencyPair,
  factsAsOf: CalendarDate,
): FxRate | undefined {
  const oldest = tryAddDays(factsAsOf, -maxRateAgeDays) ?? firstDate;
  const candidates = table.rates.filter(
    (rate) =>
      rate.from === pair.from &&
      rate.to === pair.to &&
      compareDates(rate.date, factsAsOf) <= 0 &&
      compareDates(rate.date, oldest) >= 0,
  );
  const latest = candidates.reduce<FxRate | undefined>(
    (best, rate) => (best === undefined || compareDates(rate.date, best.date) > 0 ? rate : best),
    undefined,
  );
  if (latest !== undefined && candidates.filter((rate) => rate.date === latest.date).length > 1) {
    throw new RangeError('Two rates for the same pair and date');
  }
  return latest;
}

/** Converts exactly, with no rounding. A missing rate is reported, never guessed. */
export function convert(
  amount: ExactAmount,
  to: CurrencyCode,
  table: FxTable,
  factsAsOf: CalendarDate,
): Conversion {
  if (amount.currency === to) return { kind: 'converted', amount };
  const pair = { from: amount.currency, to };
  const rate = findRate(table, pair, factsAsOf);
  if (rate === undefined) return { kind: 'missing_rate', pair };
  const multiplier = scaledDecimal(rate.rate);
  const exponentShift = minorUnitExponent(to) - minorUnitExponent(amount.currency);
  const converted = normalizeScaled({
    units: amount.units * multiplier.units * powerOfTen(Math.max(0, exponentShift)),
    scale: amount.scale + multiplier.scale + Math.max(0, -exponentShift),
  });
  return { kind: 'converted', amount: { ...converted, currency: to }, rate };
}

function rateKey(rate: FxRate): string {
  return `${rate.from}>${rate.to}@${rate.date}`;
}
