import type { CalendarDate } from '../calendar/calendar-date.js';
import {
  type Decimal,
  alignAll,
  parseDecimal,
  roundQuotientHalfEven,
  scaledDecimal,
} from '../money/decimal.js';
import type { Source } from '../rules/route-version.js';
import { isStale } from '../rules/staleness.js';
import type { ComparisonPreferences } from './schema.js';
import type { ComparisonEntry } from './select.js';

/** A criterion as one person's comparison counts it: from the version, or one they created. */
export type ComparedCriterion = (
  | {
      readonly kind: 'indicator' | 'category' | 'personal';
      /** The knowledge title, shown as is unless the interface has its own label for this `id`. */
      readonly title: string;
    }
  | {
      readonly kind: 'own';
      /** The person's own name for it: case data, never logged and never sent to a model. */
      readonly name: string;
    }
) & {
  readonly id: string;
  readonly weight: number;
  readonly defaultWeight: number;
};

/** What an objective score was computed from. */
export interface IndicatorReading {
  readonly value: string;
  readonly year: number;
  readonly source: Source;
  /** Verified more than 90 days before today (spec 0002, R9). */
  readonly stale: boolean;
}

export interface CriterionScore {
  readonly criterion: string;
  /** From 0 to 10, rounded half-even to one decimal place; null when unknown. */
  readonly score: Decimal | null;
  readonly reading?: IndicatorReading;
  /** The person's stars, for a personal or own criterion they rated. */
  readonly rating?: number;
}

export type CountryComparison = (
  | { readonly group: 'ranked'; readonly rank: number }
  | { readonly group: 'few-data' | 'hidden'; readonly rank: null }
) & {
  readonly country: string;
  /** The weighted mean of the known scores, rounded half-even to one decimal place. */
  readonly total: Decimal | null;
  /** The known weight over all weight, as a whole percentage rounded down. */
  readonly coverage: number;
  readonly scores: readonly CriterionScore[];
};

export interface DestinationComparison {
  readonly criteria: readonly ComparedCriterion[];
  /**
   * Ranked countries first, then the "Poucos dados" group, each in ranking order, then the
   * countries the person hid, in the order given.
   */
  readonly countries: readonly CountryComparison[];
}

export interface ComparisonInput {
  readonly entry: ComparisonEntry;
  readonly preferences: ComparisonPreferences;
  /** The countries to compare: those with a route in the catalog. */
  readonly countries: readonly string[];
  readonly today: CalendarDate;
}

/** The weight an own criterion has until the person sets one: the middle of the scale. */
export const ownDefaultWeight = 3;

/** An exact non-negative ratio; the denominator is always positive. */
interface Ratio {
  readonly n: bigint;
  readonly d: bigint;
}

const zero: Ratio = { n: 0n, d: 1n };
const ten: Ratio = { n: 10n, d: 1n };

function ratio(n: bigint, d: bigint): Ratio {
  return d < 0n ? { n: -n, d: -d } : { n, d };
}

function compareRatios(left: Ratio, right: Ratio): number {
  const a = left.n * right.d;
  const b = right.n * left.d;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function add(left: Ratio, right: Ratio): Ratio {
  return ratio(left.n * right.d + right.n * left.d, left.d * right.d);
}

function oneDecimal(value: Ratio): Decimal {
  const tenths = roundQuotientHalfEven(value.n * 10n, value.d);
  const whole = tenths / 10n;
  const fraction = tenths % 10n;
  return parseDecimal(fraction === 0n ? String(whole) : `${String(whole)}.${String(fraction)}`);
}

/**
 * A percentage rounded down, so a share just under one half never reads as 50 while the country
 * sits in "Poucos dados".
 */
function wholePercentDown(value: Ratio): number {
  return Number((value.n * 100n) / value.d);
}

function clampToScale(value: Ratio): Ratio {
  if (compareRatios(value, zero) < 0) return zero;
  if (compareRatios(value, ten) > 0) return ten;
  return value;
}

/** `10 × (value − zeroAt) / (tenAt − zeroAt)`, clamped to 0..10; exact. */
function anchoredScore(value: Decimal, zeroAt: Decimal, tenAt: Decimal): Ratio {
  const {
    units: [v = 0n, z = 0n, t = 0n],
  } = alignAll([value, zeroAt, tenAt].map(scaledDecimal));
  return clampToScale(ratio(10n * (v - z), t - z));
}

/** One to five stars, linearly onto 0..10. */
function starScore(stars: number): Ratio {
  return ratio(BigInt(stars - 1) * 5n, 2n);
}

/** An own property only, so a criterion named like an `Object` member never reads one. */
function ownValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

interface Scored {
  readonly score: CriterionScore;
  readonly exact?: Ratio;
}

interface Totalled {
  readonly country: string;
  readonly total: Ratio | null;
  readonly coverage: Ratio;
  readonly halfKnown: boolean;
  readonly scores: readonly CriterionScore[];
}

function byRanking(left: Totalled, right: Totalled): number {
  if (left.total !== null && right.total !== null) {
    const totals = compareRatios(right.total, left.total);
    if (totals !== 0) return totals;
  } else if (left.total !== right.total) {
    return left.total === null ? 1 : -1;
  }
  const coverage = compareRatios(right.coverage, left.coverage);
  if (coverage !== 0) return coverage;
  if (left.country === right.country) return 0;
  return left.country < right.country ? -1 : 1;
}

/**
 * The destination comparison of one person (ADR-0026): per country, a score from 0 to 10 for each
 * criterion, the weighted mean of the known scores and the share of weight they cover, and the
 * ranking. Unknown scores stay out of the total and lower the coverage instead of counting as zero.
 */
export function compareDestinations({
  entry,
  preferences,
  countries,
  today,
}: ComparisonInput): DestinationComparison {
  const criteria: ComparedCriterion[] = [
    ...entry.version.criteria.map(({ id, kind, title, defaultWeight }) => ({
      id,
      kind,
      title,
      weight: ownValue(preferences.weights, id) ?? defaultWeight,
      defaultWeight,
    })),
    ...preferences.ownCriteria.map(({ id, name }) => ({
      id,
      kind: 'own' as const,
      name,
      weight: ownValue(preferences.weights, id) ?? ownDefaultWeight,
      defaultWeight: ownDefaultWeight,
    })),
  ];
  const indicators = new Map(entry.indicators.map((indicator) => [indicator.id, indicator]));
  const knowledge = new Map(entry.version.criteria.map((criterion) => [criterion.id, criterion]));
  const hidden = new Set(preferences.hidden);

  const scoreOf = (criterion: ComparedCriterion, country: string): Scored => {
    const definition = knowledge.get(criterion.id);
    if (definition === undefined || definition.kind === 'personal') {
      const byCountry = ownValue(preferences.ratings, criterion.id);
      const rating = byCountry === undefined ? undefined : ownValue(byCountry, country);
      if (rating === undefined) return { score: { criterion: criterion.id, score: null } };
      const exact = starScore(rating);
      return { score: { criterion: criterion.id, score: oneDecimal(exact), rating }, exact };
    }
    const indicator = indicators.get(definition.indicator);
    const countryValue = indicator?.values.find((value) => value.country === country);
    const source = indicator?.sources.find((each) => each.id === countryValue?.source);
    if (countryValue === undefined || source === undefined) {
      return { score: { criterion: criterion.id, score: null } };
    }
    const reading: IndicatorReading = {
      value: countryValue.value,
      year: countryValue.year,
      source,
      stale: isStale(source, today),
    };
    let exact: Ratio | undefined;
    if (definition.kind === 'indicator') {
      exact = anchoredScore(parseDecimal(countryValue.value), definition.zeroAt, definition.tenAt);
    } else {
      const token = definition.scores.find((each) => each.token === countryValue.value);
      exact = token === undefined ? undefined : ratio(BigInt(token.score), 1n);
    }
    return exact === undefined
      ? { score: { criterion: criterion.id, score: null, reading } }
      : { score: { criterion: criterion.id, score: oneDecimal(exact), reading }, exact };
  };

  const weightTotal = BigInt(criteria.reduce((sum, criterion) => sum + criterion.weight, 0));
  const totalled = [...new Set(countries)].map((country): Totalled => {
    const scored = criteria.map((criterion) => ({ criterion, ...scoreOf(criterion, country) }));
    let weighted = zero;
    let known = 0n;
    for (const { criterion, exact } of scored) {
      if (exact === undefined || criterion.weight === 0) continue;
      const weight = BigInt(criterion.weight);
      weighted = add(weighted, ratio(exact.n * weight, exact.d));
      known += weight;
    }
    return {
      country,
      total: known === 0n ? null : ratio(weighted.n, weighted.d * known),
      coverage: weightTotal === 0n ? zero : ratio(known, weightTotal),
      halfKnown: weightTotal > 0n && 2n * known >= weightTotal,
      scores: scored.map(({ score }) => score),
    };
  });

  const shown = (each: Totalled) => ({
    country: each.country,
    total: each.total === null ? null : oneDecimal(each.total),
    coverage: wholePercentDown(each.coverage),
    scores: each.scores,
  });
  const visible = totalled.filter((each) => !hidden.has(each.country));
  return {
    criteria,
    countries: [
      ...visible
        .filter((each) => each.halfKnown)
        .sort(byRanking)
        .map((each, index) => ({ ...shown(each), group: 'ranked' as const, rank: index + 1 })),
      ...visible
        .filter((each) => !each.halfKnown)
        .sort(byRanking)
        .map((each) => ({ ...shown(each), group: 'few-data' as const, rank: null })),
      ...totalled
        .filter((each) => hidden.has(each.country))
        .map((each) => ({ ...shown(each), group: 'hidden' as const, rank: null })),
    ],
  };
}
