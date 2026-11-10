import type { CalendarDate } from '../calendar/calendar-date.js';
import { durationParts, type Duration } from '../calendar/duration.js';
import { type CurrencyCode, unitsAmount } from '../money/currency.js';
import type { CatalogEntry } from '../rules/catalog.js';
import { type Expression, childrenOf } from '../rules/expression.js';
import type { Pin, Source } from '../rules/route-version.js';
import { type CheckValue, canonicalNumber } from './values.js';

export const checkItemKinds = [
  'requirement',
  'assessment',
  'dependent',
  'cost',
  'duration',
  'leapDayBirthday',
  'closure',
  'countrySet',
] as const;
export type CheckItemKind = (typeof checkItemKinds)[number];

/** One thing the independent check compares with the official pages it cites (ADR-0027). */
export interface CheckItem {
  /** Stable across versions: the kind and the item's ID, such as `requirement:min-investment`. */
  readonly key: string;
  readonly kind: CheckItemKind;
  readonly title: string;
  /** The `official` sources the item cites, in the order it cites them; secondary ones are not read. */
  readonly urls: readonly string[];
  /** The official-domain lists that cover those URLs: the version's, or a country set's own. */
  readonly officialDomains: readonly Pin[];
  /** What a quote must state for a match to count; empty when the item states no value. */
  readonly values: readonly CheckValue[];
}

/** The longest item key: a kind, a colon and a slug, or a country set's `<id>/<number>`. */
export const maxCheckItemKeyLength = 120;

/**
 * 0 and 1 are left out of the values, as integers, duration parts and factors alike: in a rule they
 * are structure, such as "at least one", "none" or "one year", which law text writes in words.
 */
const structuralIntegers = new Set([0, 1]);

const numberValue = (decimal: string): CheckValue => ({
  kind: 'number',
  value: canonicalNumber(decimal),
});

function durationValues(duration: Duration): CheckValue[] {
  const { years, months, days } = durationParts(duration);
  return [years, months, days]
    .filter((part) => !structuralIntegers.has(part))
    .map((part) => numberValue(String(part)));
}

/** The values an expression states, without repeats, in the order they appear. */
export function expressionValues(expression: Expression): CheckValue[] {
  const values: CheckValue[] = [];
  const stack: Expression[] = [expression];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    switch (node.op) {
      case 'int':
        if (!structuralIntegers.has(node.value)) values.push(numberValue(String(node.value)));
        break;
      case 'decimal':
        values.push(numberValue(node.value));
        break;
      case 'money':
        values.push(numberValue(unitsAmount(node.amount, node.currency as CurrencyCode)));
        break;
      case 'date':
        values.push({ kind: 'date', value: node.value as CalendarDate });
        break;
      case 'mul':
        if (!structuralIntegers.has(Number(node.by))) values.push(numberValue(node.by));
        break;
      case 'since':
        values.push(...durationValues(node.duration as Duration));
        break;
      default:
        break;
    }
    stack.push(...[...childrenOf(node)].reverse());
  }
  return uniqueValues(values);
}

function uniqueValues(values: readonly CheckValue[]): CheckValue[] {
  const seen = new Map(values.map((value) => [`${value.kind}:${value.value}`, value]));
  return [...seen.values()];
}

function officialUrls(ids: readonly string[], sources: readonly Source[]): string[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return [
    ...new Set(
      ids
        .map((id) => byId.get(id))
        .filter((source) => source?.kind === 'official')
        .map((source) => source?.url ?? ''),
    ),
  ];
}

/**
 * The machine-readable address each cited official URL is read through in place of its page: the
 * one every official source at that URL names, the version's and its country sets' alike. A URL
 * whose sources name different addresses, or that some of them leave without one, is read as
 * itself, so no source's address is chosen over another's.
 */
export function machineReadableUrls({
  version,
  countrySets,
}: CatalogEntry): ReadonlyMap<string, string> {
  const named = new Map<string, Set<string | undefined>>();
  for (const { kind, url, machineReadableUrl } of [version, ...countrySets].flatMap(
    ({ sources }) => sources,
  )) {
    if (kind !== 'official') continue;
    named.set(url, (named.get(url) ?? new Set()).add(machineReadableUrl));
  }
  const addresses = new Map<string, string>();
  for (const [url, names] of named) {
    const [only] = names;
    if (names.size === 1 && only !== undefined) addresses.set(url, only);
  }
  return addresses;
}

/**
 * Every item of a route version the check compares (ADR-0027), by stable key: each requirement,
 * assessment, dependent rule, cost and duration, the leap-day rule and the closure when the version
 * has them, and each pinned country set's members, which are read on the set's own sources and
 * official-domain lists. Settings that cite no source are not items.
 */
export function checkItems({ version, countrySets }: CatalogEntry): readonly CheckItem[] {
  const urls = (ids: readonly string[]) => officialUrls(ids, version.sources);
  const own = { officialDomains: version.officialDomains };
  const item = (
    kind: CheckItemKind,
    id: string | undefined,
    title: string,
    sources: readonly string[],
    values: readonly CheckValue[],
  ): CheckItem => ({
    key: id === undefined ? kind : `${kind}:${id}`,
    kind,
    title,
    urls: urls(sources),
    ...own,
    values,
  });
  return [
    ...version.requirements.map(({ id, title, expression, sources }) =>
      item('requirement', id, title, sources, expressionValues(expression)),
    ),
    ...version.assessments.map(({ id, title, sources }) =>
      item('assessment', id, title, sources, []),
    ),
    ...version.dependents.map(({ id, title, condition, sources }) =>
      item('dependent', id, title, sources, expressionValues(condition)),
    ),
    ...version.costs.map(({ id, title, amount, condition, sources }) =>
      item('cost', id, title, sources, [
        ...expressionValues(amount),
        ...(condition === undefined ? [] : expressionValues(condition)),
      ]),
    ),
    ...version.durations.map(({ id, title, min, max, sources }) =>
      item(
        'duration',
        id,
        title,
        sources,
        uniqueValues([...durationValues(min), ...durationValues(max)]),
      ),
    ),
    ...(version.leapDayBirthday === undefined
      ? []
      : [
          item(
            'leapDayBirthday',
            undefined,
            version.title,
            version.leapDayBirthdaySources ?? [],
            [],
          ),
        ]),
    ...(version.status === 'closed'
      ? [item('closure', undefined, version.title, version.closureSources ?? [], [])]
      : []),
    ...countrySets.map((set) => ({
      key: `countrySet:${set.id}/${String(set.number)}`,
      kind: 'countrySet' as const,
      title: set.title,
      urls: officialUrls(
        set.sources.map((source) => source.id),
        set.sources,
      ),
      officialDomains: set.officialDomains,
      values: [],
    })),
  ];
}
