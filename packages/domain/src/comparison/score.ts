import { type CalendarDate, daysBetween } from '../calendar/calendar-date.js';
import { type Decimal, parseDecimal, powerOfTen, scaledDecimal } from '../money/decimal.js';
import type { DecisionState, DecisionStates } from '../rules/catalog.js';
import type { EvaluationStatus } from '../rules/engine.js';
import type { Source } from '../rules/route-version.js';
import { staleAfterDays } from '../rules/staleness.js';
import type {
  ComparisonCriterion,
  ComparisonPreferences,
  ComparisonVersion,
  CountryIndicator,
} from './schema.js';

/** What selection may read about any comparison version, proposed ones included. */
export interface ComparisonIdentity {
  readonly comparisonId: string;
  readonly number: number;
  /** The content hash over the version and every indicator it pins (ADR-0026). */
  readonly hash: string;
}

/** A validated comparison version with exactly the indicators it pins. */
export interface ComparisonEntry {
  readonly identity: ComparisonIdentity;
  readonly version: ComparisonVersion;
  readonly indicators: readonly CountryIndicator[];
}

/**
 * The key of a comparison version in `DecisionStates`. It has four segments where a route's has
 * three, so a comparison decision can never count for a route version, nor the reverse.
 */
export function comparisonIdentityKey(identity: ComparisonIdentity): string {
  return `comparison/${identity.comparisonId}/${String(identity.number)}/${identity.hash}`;
}

export function comparisonStateOf(
  identity: ComparisonIdentity,
  states: DecisionStates,
): DecisionState {
  return states.get(comparisonIdentityKey(identity)) ?? 'proposed';
}

export interface ComparisonSelection {
  /** The highest-numbered active version, if any. */
  readonly active?: ComparisonIdentity;
  /** Whether a higher-numbered version waits for a decision: its identity read, never its content. */
  readonly pendingNewer: boolean;
}

/** Picks the comparison version to use (ADR-0026): no effective dates, the newest active one wins. */
export function selectComparisonVersion(
  identities: readonly ComparisonIdentity[],
  states: DecisionStates,
): ComparisonSelection {
  const newestFirst = [...identities].sort((left, right) => right.number - left.number);
  const active = newestFirst.find((identity) => comparisonStateOf(identity, states) === 'active');
  const pendingNewer = newestFirst.some(
    (identity) =>
      comparisonStateOf(identity, states) === 'proposed' &&
      (active === undefined || identity.number > active.number),
  );
  return active === undefined ? { pendingNewer } : { active, pendingNewer };
}

export type RouteStatus = EvaluationStatus | 'pending_activation';

/** From the best a person can have in a country to the worst; the comparison shows the first. */
export const routeStatusOrder: readonly RouteStatus[] = [
  'eligible',
  'needs_assessment',
  'missing_information',
  'pending_activation',
  'not_eligible',
  'unavailable',
];

/** The best of a country's route statuses for one person, or undefined when there are none. */
export function bestRouteStatus(statuses: readonly RouteStatus[]): RouteStatus | undefined {
  return routeStatusOrder.find((status) => statuses.includes(status));
}

export type ComparedKind = ComparisonCriterion['kind'] | 'own';

export interface ComparedCriterion {
  readonly id: string;
  readonly kind: ComparedKind;
  /** The knowledge title, in English, for a criterion of the version; absent for an own one. */
  readonly title?: string;
  /** The person's own name for an own criterion. */
  readonly name?: string;
  readonly weight: number;
  readonly defaultWeight: number;
}

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

export interface CountryComparison {
  readonly country: string;
  /** Position among countries with enough data, from 1; null for the "Poucos dados" group. */
  readonly rank: number | null;
  readonly group: 'ranked' | 'few-data';
  /** The weighted mean of the known scores, rounded half-even to one decimal place. */
  readonly total: Decimal | null;
  /** The known weight over all weight, as a whole percentage rounded half-even. */
  readonly coverage: number;
  readonly scores: readonly CriterionScore[];
}

export interface DestinationComparison {
  readonly criteria: readonly ComparedCriterion[];
  /** Ranked countries first, then the "Poucos dados" group, each in ranking order. */
  readonly countries: readonly CountryComparison[];
  /** Countries the person hid, in the order given. */
  readonly hidden: readonly string[];
}

export interface ComparisonInput {
  readonly entry: ComparisonEntry;
  readonly preferences: ComparisonPreferences;
  /** The countries to compare: those with a route in the catalog. */
  readonly countries: readonly string[];
  readonly today: CalendarDate;
}

/** The weight an own criterion has until the person sets one. */
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

function times(value: Ratio, factor: bigint): Ratio {
  return ratio(value.n * factor, value.d);
}

function divide(left: Ratio, right: Ratio): Ratio {
  return ratio(left.n * right.d, left.d * right.n);
}

/** Rounds `n / d` half-even to an integer; `d` is positive. */
function roundHalfEven(n: bigint, d: bigint): bigint {
  const floor = n >= 0n ? n / d : -((-n + d - 1n) / d);
  const twice = 2n * (n - floor * d);
  if (twice < d) return floor;
  if (twice > d) return floor + 1n;
  return floor % 2n === 0n ? floor : floor + 1n;
}

function oneDecimal(value: Ratio): Decimal {
  const tenths = roundHalfEven(value.n * 10n, value.d);
  const whole = tenths / 10n;
  const fraction = tenths % 10n;
  return parseDecimal(fraction === 0n ? String(whole) : `${String(whole)}.${String(fraction)}`);
}

function clampToScale(value: Ratio): Ratio {
  if (compareRatios(value, zero) < 0) return zero;
  if (compareRatios(value, ten) > 0) return ten;
  return value;
}

/** `10 × (value − zeroAt) / (tenAt − zeroAt)`, clamped to 0..10; exact. */
function anchoredScore(value: Decimal, zeroAt: Decimal, tenAt: Decimal): Ratio {
  const parts = [value, zeroAt, tenAt].map(scaledDecimal);
  const scale = Math.max(...parts.map((part) => part.scale));
  const [v = 0n, z = 0n, t = 0n] = parts.map((part) => part.units * powerOfTen(scale - part.scale));
  return clampToScale(ratio(10n * (v - z), t - z));
}

/** One to five stars, linearly onto 0..10. */
function starScore(stars: number): Ratio {
  return ratio(BigInt(stars - 1) * 5n, 2n);
}

interface Scored {
  readonly score: CriterionScore;
  readonly exact?: Ratio;
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
    ...entry.version.criteria.map((criterion) => ({
      id: criterion.id,
      kind: criterion.kind,
      title: criterion.title,
      weight: preferences.weights[criterion.id] ?? criterion.defaultWeight,
      defaultWeight: criterion.defaultWeight,
    })),
    ...preferences.ownCriteria.map(({ id, name }) => ({
      id,
      kind: 'own' as const,
      name,
      weight: preferences.weights[id] ?? ownDefaultWeight,
      defaultWeight: ownDefaultWeight,
    })),
  ];
  const indicators = new Map(entry.indicators.map((indicator) => [indicator.id, indicator]));
  const knowledge = new Map(entry.version.criteria.map((criterion) => [criterion.id, criterion]));
  const hidden = new Set(preferences.hidden);

  const scoreOf = (criterion: ComparedCriterion, country: string): Scored => {
    const definition = knowledge.get(criterion.id);
    if (definition === undefined || definition.kind === 'personal') {
      const rating = preferences.ratings[criterion.id]?.[country];
      if (rating === undefined) return { score: { criterion: criterion.id, score: null } };
      const exact = starScore(rating);
      return { score: { criterion: criterion.id, score: oneDecimal(exact), rating }, exact };
    }
    const indicator = indicators.get(definition.indicator);
    const entryValue = indicator?.values.find((value) => value.country === country);
    const source = indicator?.sources.find((each) => each.id === entryValue?.source);
    if (entryValue === undefined || source === undefined) {
      return { score: { criterion: criterion.id, score: null } };
    }
    const reading: IndicatorReading = {
      value: entryValue.value,
      year: entryValue.year,
      source,
      stale: daysBetween(source.verifiedAt, today) > staleAfterDays,
    };
    let exact: Ratio | undefined;
    if (definition.kind === 'indicator') {
      exact = anchoredScore(parseDecimal(entryValue.value), definition.zeroAt, definition.tenAt);
    } else {
      const token = definition.scores.find((each) => each.token === entryValue.value);
      exact = token === undefined ? undefined : ratio(BigInt(token.score), 1n);
    }
    return exact === undefined
      ? { score: { criterion: criterion.id, score: null, reading } }
      : { score: { criterion: criterion.id, score: oneDecimal(exact), reading }, exact };
  };

  const weightTotal = BigInt(criteria.reduce((sum, criterion) => sum + criterion.weight, 0));
  const compared = countries
    .filter((country) => !hidden.has(country))
    .map((country) => {
      const scored = criteria.map((criterion) => ({ criterion, ...scoreOf(criterion, country) }));
      let weighted = zero;
      let known = 0n;
      for (const { criterion, exact } of scored) {
        if (exact === undefined || criterion.weight === 0) continue;
        weighted = add(weighted, times(exact, BigInt(criterion.weight)));
        known += BigInt(criterion.weight);
      }
      const total = known === 0n ? null : divide(weighted, ratio(known, 1n));
      const coverage = weightTotal === 0n ? zero : ratio(known, weightTotal);
      return {
        country,
        total,
        coverage,
        enough: weightTotal > 0n && 2n * known >= weightTotal,
        scores: scored.map(({ score }) => score),
      };
    });

  const byRanking = (left: (typeof compared)[number], right: (typeof compared)[number]) => {
    if (left.total !== null && right.total !== null) {
      const totals = compareRatios(right.total, left.total);
      if (totals !== 0) return totals;
    } else if (left.total !== right.total) {
      return left.total === null ? 1 : -1;
    }
    const coverage = compareRatios(right.coverage, left.coverage);
    if (coverage !== 0) return coverage;
    return left.country < right.country ? -1 : left.country > right.country ? 1 : 0;
  };
  const ranked = compared.filter((each) => each.enough).sort(byRanking);
  const fewData = compared.filter((each) => !each.enough).sort(byRanking);

  const present = (each: (typeof compared)[number], rank: number | null): CountryComparison => ({
    country: each.country,
    rank,
    group: rank === null ? 'few-data' : 'ranked',
    total: each.total === null ? null : oneDecimal(each.total),
    coverage: Number(roundHalfEven(each.coverage.n * 100n, each.coverage.d)),
    scores: each.scores,
  });

  return {
    criteria,
    countries: [
      ...ranked.map((each, index) => present(each, index + 1)),
      ...fewData.map((each) => present(each, null)),
    ],
    hidden: countries.filter((country) => hidden.has(country)),
  };
}
