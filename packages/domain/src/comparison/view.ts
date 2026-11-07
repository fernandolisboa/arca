import type { DecisionState, DecisionStates } from '../rules/catalog.js';
import type { Source } from '../rules/route-version.js';
import { type SectionChange, sectionChange } from '../rules/version-view.js';
import type { ComparisonCriterion, CountryIndicator } from './schema.js';
import {
  type ComparisonEntry,
  comparisonIdentityKey,
  comparisonStateOf,
  selectComparisonVersion,
} from './select.js';

/** One country's value as the admin reviews it, beside the value it replaces. */
export interface IndicatorValueView {
  readonly country: string;
  readonly value: string;
  readonly year: number;
  readonly source: string;
  /** The host of the source's URL, or null when it is not a plain `https` URL. */
  readonly host: string | null;
  /** The value and year this country had in the replaced version, or null when it had none. */
  readonly previous: { readonly value: string; readonly year: number } | null;
}

export interface IndicatorView {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly unit: string;
  readonly valueType: CountryIndicator['valueType'];
  readonly sources: readonly (Source & { readonly host: string | null })[];
  readonly values: readonly IndicatorValueView[];
  /** Countries the replaced version had a value for and this one does not. */
  readonly removed: readonly string[];
}

/** What rejecting this version does to the comparison today (ADR-0026). */
export interface ComparisonRejectionEffect {
  /** The comparison uses this version today. */
  readonly selected: boolean;
  /** The version it would use instead, or null for none at all. */
  readonly fallback: { readonly number: number } | null;
}

/** A comparison version laid out for the admin (ADR-0026), built from its content alone. */
export interface ComparisonVersionView {
  readonly comparisonId: string;
  readonly number: number;
  readonly hash: string;
  readonly state: DecisionState;
  readonly title: string;
  readonly criteria: readonly ComparisonCriterion[];
  readonly indicators: readonly IndicatorView[];
  /** The version before it and what changed, by criterion and indicator ID. */
  readonly replaces: {
    readonly number: number;
    readonly criteria: SectionChange;
    readonly indicators: SectionChange;
  } | null;
  readonly rejection: ComparisonRejectionEffect;
}

export interface ComparisonVersionViewInput {
  /** Every version of the comparison the catalog holds, this one included. */
  readonly entries: readonly ComparisonEntry[];
  readonly number: number;
  readonly states: DecisionStates;
  /** The host of a plain `https` URL, or undefined; the domain has no URL parser. */
  readonly hostOf: (url: string) => string | undefined;
}

/** An indicator without its number, so a refresh that changes nothing shows no change. */
const indicatorContent = (indicator: CountryIndicator) => ({ ...indicator, number: 0 });

function indicatorView(
  indicator: CountryIndicator,
  before: CountryIndicator | undefined,
  hostOf: ComparisonVersionViewInput['hostOf'],
): IndicatorView {
  const sources = indicator.sources.map((source) => ({
    ...source,
    host: hostOf(source.url) ?? null,
  }));
  const hosts = new Map(sources.map(({ id, host }) => [id, host]));
  const previous = new Map(before?.values.map((each) => [each.country, each]));
  const current = new Set(indicator.values.map(({ country }) => country));
  return {
    id: indicator.id,
    number: indicator.number,
    title: indicator.title,
    unit: indicator.unit,
    valueType: indicator.valueType,
    sources,
    values: indicator.values.map(({ country, value, year, source }) => {
      const old = previous.get(country);
      return {
        country,
        value,
        year,
        source,
        host: hosts.get(source) ?? null,
        previous: old === undefined ? null : { value: old.value, year: old.year },
      };
    }),
    removed: [...previous.keys()].filter((country) => !current.has(country)),
  };
}

/**
 * The admin's view of one comparison version (ADR-0026): its criteria, every indicator value it
 * pins with its year and source host beside the value it replaces, what changed from the version
 * before, and what a rejection would do. No model is involved.
 */
export function comparisonVersionView({
  entries,
  number,
  states,
  hostOf,
}: ComparisonVersionViewInput): ComparisonVersionView | undefined {
  const entry = entries.find((candidate) => candidate.identity.number === number);
  if (entry === undefined) return undefined;
  const { identity, version, indicators } = entry;
  const replaced = entries.find((candidate) => candidate.identity.number === number - 1);
  const earlier = (id: string) => replaced?.indicators.find((indicator) => indicator.id === id);
  const identities = entries.map((candidate) => candidate.identity);
  const now = selectComparisonVersion(identities, states).active;
  const after = selectComparisonVersion(
    identities,
    new Map(states).set(comparisonIdentityKey(identity), 'rejected'),
  ).active;
  return {
    comparisonId: identity.comparisonId,
    number,
    hash: identity.hash,
    state: comparisonStateOf(identity, states),
    title: version.title,
    criteria: version.criteria,
    indicators: indicators.map((indicator) =>
      indicatorView(indicator, earlier(indicator.id), hostOf),
    ),
    replaces:
      replaced === undefined
        ? null
        : {
            number: replaced.identity.number,
            criteria: sectionChange(replaced.version.criteria, version.criteria),
            indicators: sectionChange(
              replaced.indicators.map(indicatorContent),
              indicators.map(indicatorContent),
            ),
          },
    rejection: {
      selected: now?.number === number,
      fallback: after === undefined ? null : { number: after.number },
    },
  };
}
