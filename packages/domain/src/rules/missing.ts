import type { MissingMarker } from '../case/paths.js';
import type { Relationship } from '../case/snapshot.js';
import { type Truth, and, not, or } from '../logic/truth.js';
import { isKnown } from '../logic/value.js';
import type { CurrencyPair, FxRate } from '../money/fx.js';
import { type Trace, truthOf } from './evaluate.js';

/**
 * Something the family can answer that would change a result: a fact about a person, whether a
 * relationship held at the date, or whether a kind of relationship or asset is recorded in full.
 */
export type MissingFact =
  | { readonly kind: 'fact'; readonly reference: string; readonly personId: string }
  | { readonly kind: 'relationship'; readonly edge: Relationship }
  | ({ readonly kind: 'marker' } & MissingMarker);

/** What makes each possible unit member possible, and the unit's own open markers. */
export interface UnitGaps {
  readonly member: (personId: string) => readonly MissingFact[];
  readonly all: () => readonly MissingFact[];
}

/**
 * The missing facts at the unknown leaves of a trace that no known operand cuts off (spec 0002,
 * R5): a false inside `all` or a true inside `any` decides without the others, and a collection
 * item that cannot change the answer adds nothing. Facts that matter only together are all listed.
 * FX rates and context dates are reported apart, since the family cannot answer them.
 */
export function decisiveFacts(trace: Trace, unit: UnitGaps): MissingFact[] {
  return distinct(collect(trace, unit));
}

function collect(trace: Trace, unit: UnitGaps): MissingFact[] {
  if (trace.value.type === 'set' || isKnown(trace.value)) return [];
  switch (trace.op) {
    case 'fact':
      return factGaps(trace, unit);
    case 'all':
    case 'any':
      return trace.children
        .filter((child) => truthOf(child) === 'unknown')
        .flatMap((child) => collect(child, unit));
    case 'count':
    case 'some':
    case 'every':
    case 'sum':
      return collectionGaps(trace, unit);
    default:
      return trace.children.flatMap((child) => collect(child, unit));
  }
}

function factGaps(trace: Trace, unit: UnitGaps): MissingFact[] {
  if (trace.fact === undefined || trace.missingDate !== undefined) return [];
  const gaps: MissingFact[] = (trace.missingMarkers ?? []).map(marker);
  if (trace.missingRates === undefined) {
    const { reference, personId } = trace.fact;
    gaps.push({ kind: 'fact', reference, personId });
  }
  if (trace.fact.reference.startsWith('unit.')) gaps.push(...unit.all());
  return gaps;
}

function collectionGaps(trace: Trace, unit: UnitGaps): MissingFact[] {
  const gaps: MissingFact[] = (trace.incomplete?.missingMarkers ?? []).map(marker);
  for (const item of trace.children) {
    const info = item.item;
    if (info === undefined) continue;
    const { condition, value } = parts(trace.op, item.children);
    const { membership } = info;
    const holds: Truth = condition === undefined ? true : truthOf(condition);
    const membershipGaps = (): readonly MissingFact[] =>
      info.uncertainEdges?.map((edge): MissingFact => ({ kind: 'relationship', edge })) ??
      unit.member(info.personId);
    if (trace.op === 'every') {
      if (or([not(membership), holds]) !== 'unknown') continue;
      if (holds === 'unknown' && condition !== undefined) gaps.push(...collect(condition, unit));
      if (membership === 'unknown' && holds !== true) gaps.push(...membershipGaps());
      continue;
    }
    const counts = and([membership, holds]);
    if (counts === false) continue;
    if (counts === 'unknown') {
      if (holds === 'unknown' && condition !== undefined) gaps.push(...collect(condition, unit));
      if (membership === 'unknown') gaps.push(...membershipGaps());
    }
    if (value !== undefined) gaps.push(...collect(value, unit));
  }
  return gaps;
}

/** An item's children: the condition, then for a sum the summand. */
function parts(op: Trace['op'], children: readonly Trace[]): { condition?: Trace; value?: Trace } {
  if (op !== 'sum') return children[0] === undefined ? {} : { condition: children[0] };
  const value = children.at(-1);
  const condition = children.length === 2 ? children[0] : undefined;
  return {
    ...(condition === undefined ? {} : { condition }),
    ...(value === undefined ? {} : { value }),
  };
}

/** FX rates and reference dates a set of traces lacked or used, each listed once. */
export interface TraceGaps {
  readonly missingRates: readonly CurrencyPair[];
  readonly missingDates: readonly string[];
  readonly rates: readonly FxRate[];
}

export function traceGaps(traces: readonly Trace[]): TraceGaps {
  const missingRates = new Map<string, CurrencyPair>();
  const missingDates = new Set<string>();
  const rates = new Map<string, FxRate>();
  const stack = [...traces];
  for (let trace = stack.pop(); trace !== undefined; trace = stack.pop()) {
    for (const pair of trace.missingRates ?? []) missingRates.set(`${pair.from}>${pair.to}`, pair);
    for (const rate of trace.rates ?? []) {
      rates.set(`${rate.from}>${rate.to}@${rate.date}`, rate);
    }
    if (trace.missingDate !== undefined) missingDates.add(trace.missingDate);
    stack.push(...trace.children);
  }
  return {
    missingRates: [...missingRates.values()],
    missingDates: [...missingDates],
    rates: [...rates.values()],
  };
}

export function distinct(facts: readonly MissingFact[]): MissingFact[] {
  const seen = new Map<string, MissingFact>();
  for (const fact of facts) seen.set(keyOf(fact), fact);
  return [...seen.values()];
}

function keyOf(fact: MissingFact): string {
  switch (fact.kind) {
    case 'fact':
      return `fact:${fact.reference}:${fact.personId}`;
    case 'marker':
      return `marker:${fact.personId}:${fact.marker}`;
    case 'relationship':
      return `relationship:${JSON.stringify(fact.edge)}`;
  }
}

function marker(missing: MissingMarker): MissingFact {
  return { kind: 'marker', personId: missing.personId, marker: missing.marker };
}
