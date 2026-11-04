import type { CalendarDate } from '../calendar/calendar-date.js';
import { indexSnapshot } from '../case/graph.js';
import type { CaseSnapshot } from '../case/snapshot.js';
import { addNumbers, hullNumbers, orZero, zeroBound } from '../logic/number.js';
import { type Truth, and, or } from '../logic/truth.js';
import { type NumberValue, type Value, isKnown } from '../logic/value.js';
import type { CurrencyCode } from '../money/currency.js';
import type { CurrencyPair, FxRate } from '../money/fx.js';
import { type Money, roundHalfEven } from '../money/money.js';
import {
  type CatalogEntry,
  type RouteCatalog,
  type VersionIdentity,
  newerProposedVersion,
  sameIdentity,
  selectVersion,
} from './catalog.js';
import {
  type EvaluationContext,
  type Prepared,
  type VersionContext,
  contextDates,
  environmentOf,
  prepare,
  principalFrame,
} from './context.js';
import { type Frame, type Trace, evaluate, numberOf, truthOf } from './evaluate.js';
import { type MissingFact, type UnitGaps, decisiveFacts, distinct, traceGaps } from './missing.js';
import type { Cost, DurationStage, Source } from './route-version.js';
import { type StaleSource, staleSources } from './staleness.js';
import { type Unit, unitEnvironment, unitOf } from './unit.js';

export type EvaluationStatus =
  'unavailable' | 'not_eligible' | 'missing_information' | 'needs_assessment' | 'eligible';

export interface RequirementResult {
  readonly id: string;
  readonly title: string;
  readonly result: Truth;
  readonly sources: readonly Source[];
  readonly trace: Trace;
}

/** A judgment factor with the evidence the snapshot holds and lacks; never pass or fail. */
export interface AssessmentResult {
  readonly id: string;
  readonly title: string;
  readonly sources: readonly Source[];
  readonly present: readonly { readonly reference: string; readonly value: Value }[];
  readonly missing: readonly string[];
}

/** A bound that may be open, rounded once for display. */
export interface AmountRange {
  readonly min?: Money;
  readonly max?: Money;
}

/** One cost for one payer: it applies, may apply, or does not. */
export interface CostItem {
  readonly costId: string;
  readonly title: string;
  readonly kind: string;
  readonly appliesTo: Cost['appliesTo'];
  /** The dependent it is paid for, on an `each_dependent` cost. */
  readonly personId?: string;
  readonly applies: Truth;
  readonly amount: AmountRange;
  readonly sources: readonly Source[];
}

/**
 * Totals per currency, each from the exact sum, so shown items may differ from it by rounding:
 * what certainly applies, plus what might.
 */
export interface CostTotal {
  readonly currency: CurrencyCode;
  readonly certain: AmountRange;
  readonly possibleExtra: AmountRange;
}

export interface DurationResult extends Omit<DurationStage, 'sources'> {
  readonly sources: readonly Source[];
}

/**
 * One version applied to one snapshot (spec 0002, R5). It holds personal data: it is never
 * logged, never sent to error reports and never put in a workflow payload.
 */
export interface Evaluation {
  readonly routeId: string;
  readonly versionNumber: number;
  readonly hash: string;
  readonly engineCommit: string;
  readonly rulesAsOf: CalendarDate;
  readonly factsAsOf: CalendarDate;
  /** The date staleness was judged at (R9). */
  readonly today: CalendarDate;
  readonly referenceDates: readonly { readonly name: string; readonly date: CalendarDate }[];
  readonly principalId: string;
  readonly unit: Unit;
  readonly status: EvaluationStatus;
  readonly requirements: readonly RequirementResult[];
  readonly assessments: readonly AssessmentResult[];
  readonly missingFacts: readonly MissingFact[];
  readonly missingRates: readonly CurrencyPair[];
  readonly missingDates: readonly string[];
  readonly costs: readonly CostItem[];
  readonly totals: readonly CostTotal[];
  readonly durations: readonly DurationResult[];
  readonly rates: readonly FxRate[];
  /** The sources it cites that are stale at the context's `today` (R9). */
  readonly staleSources: readonly StaleSource[];
}

/**
 * Evaluates one given version: no selection and no activation check. Table-driven cases and the
 * reproduction of an old evaluation use it; everything that reaches a user goes through
 * `evaluateRoute`.
 */
export function evaluateVersion(
  snapshot: CaseSnapshot,
  entry: CatalogEntry,
  principalId: string,
  context: VersionContext,
): Evaluation {
  return evaluateVersionTraced(snapshot, entry, principalId, context).evaluation;
}

/**
 * `evaluateVersion` with every trace it computed: dependent conditions, requirements, assessment
 * evidence and costs. The engine's tests bound their size; nothing else needs them.
 */
export function evaluateVersionTraced(
  snapshot: CaseSnapshot,
  entry: CatalogEntry,
  principalId: string,
  context: VersionContext,
): { readonly evaluation: Evaluation; readonly traces: readonly Trace[] } {
  const prepared = prepare(snapshot, entry, principalId, context);
  const { version } = prepared;
  const { unit, traces: unitTraces } = unitOf(prepared);
  const environment = environmentOf(prepared, unitEnvironment(unit));
  const frame = principalFrame(prepared, environment);
  const cite = citations(version.sources);

  const requirements = version.requirements.map((requirement): RequirementResult => {
    const trace = evaluate(requirement.expression, frame);
    return {
      id: requirement.id,
      title: requirement.title,
      result: truthOf(trace),
      sources: cite(requirement.sources),
      trace,
    };
  });
  const evidenceTraces: Trace[] = [];
  const assessments = version.assessments.map((assessment): AssessmentResult => {
    const read = assessment.evidence.map((reference) => {
      const trace = evaluate({ op: 'fact', key: reference }, frame);
      evidenceTraces.push(trace);
      return { reference, value: valueOf(trace) };
    });
    return {
      id: assessment.id,
      title: assessment.title,
      sources: cite(assessment.sources),
      present: read.filter((entry) => isKnown(entry.value)),
      missing: read.filter((entry) => !isKnown(entry.value)).map((entry) => entry.reference),
    };
  });
  const status = statusOf(version.status, requirements, assessments.length);
  const missingFacts =
    status === 'not_eligible'
      ? []
      : distinct(
          requirements
            .filter((requirement) => requirement.result === 'unknown')
            .flatMap((requirement) => decisiveFacts(requirement.trace, unitGaps(unit))),
        );
  const costs = costItems(prepared, frame, unit, cite);
  const gaps = traceGaps([
    ...unitTraces,
    ...requirements.map((requirement) => requirement.trace),
    ...costs.traces,
  ]);
  const evaluation: Evaluation = {
    routeId: version.routeId,
    versionNumber: version.number,
    hash: entry.identity.hash,
    engineCommit: context.engineCommit,
    rulesAsOf: context.rulesAsOf,
    factsAsOf: prepared.factsAsOf,
    today: context.today,
    referenceDates: [...prepared.referenceDates].map(([name, date]) => ({ name, date })),
    principalId,
    unit,
    status,
    requirements,
    assessments,
    missingFacts,
    missingRates: gaps.missingRates,
    missingDates: [...new Set([...gaps.missingDates, ...unit.missingDates])],
    costs: costs.items,
    totals: totals(costs.priced, unit, version.costs, version.currency),
    durations: version.durations.map((stage) => ({ ...stage, sources: cite(stage.sources) })),
    rates: gaps.rates,
    staleSources: staleSources(entry, context.today),
  };
  return {
    evaluation,
    traces: [
      ...unitTraces,
      ...requirements.map((requirement) => requirement.trace),
      ...evidenceTraces,
      ...costs.traces,
    ],
  };
}

/** The outcome of a route for a case: no version, a version awaiting activation, or evaluated. */
export type RouteEvaluation =
  | { readonly kind: 'no_version'; readonly status: 'unavailable'; readonly routeId: string }
  | {
      readonly kind: 'pending';
      readonly status: 'pending_activation';
      readonly routeId: string;
      readonly pending: VersionIdentity;
    }
  | {
      readonly kind: 'evaluated';
      readonly status: EvaluationStatus;
      readonly evaluation: Evaluation;
      /**
       * It cites stale sources and is the version in effect today, so the rule needs re-checking;
       * a superseded version reached through a past `rulesAsOf` records the rule as it was (R9).
       */
      readonly stale: boolean;
      /** A version not yet active that will be in effect from `from` instead of this one. */
      readonly newerProposedVersion?: {
        readonly identity: VersionIdentity;
        readonly from: CalendarDate;
      };
    };

/**
 * Selection, then the activation check, then `evaluateVersion` (spec 0002, R5). The engine never
 * falls back to an older version on its own: a version in effect but not active is reported as
 * pending, and only an approver's rejection brings the older one back.
 */
export function evaluateRoute(
  snapshot: CaseSnapshot,
  catalog: RouteCatalog,
  routeId: string,
  principalId: string,
  context: EvaluationContext,
): RouteEvaluation {
  contextDates(indexSnapshot(snapshot), context);
  const identities = catalog.identities(routeId);
  const selection = selectVersion(identities, context.rulesAsOf, context.states);
  if (selection === undefined) return { kind: 'no_version', status: 'unavailable', routeId };
  if (selection.state !== 'active') {
    return { kind: 'pending', status: 'pending_activation', routeId, pending: selection.identity };
  }
  const entry = catalog.activeEntry(selection.identity, context.states);
  // The activation covers one exact content, so an entry for any other refuses to evaluate.
  if (entry?.identity.routeId !== routeId || !sameIdentity(entry.identity, selection.identity)) {
    throw new RangeError('The catalog has no entry for the active version selected');
  }
  const evaluation = evaluateVersion(snapshot, entry, principalId, context);
  const newer = newerProposedVersion(
    identities,
    selection.identity,
    context.rulesAsOf,
    context.states,
  );
  const current = selectVersion(identities, context.today, context.states);
  return {
    kind: 'evaluated',
    status: evaluation.status,
    evaluation,
    stale:
      evaluation.staleSources.length > 0 &&
      current !== undefined &&
      sameIdentity(current.identity, selection.identity),
    ...(newer === undefined ? {} : { newerProposedVersion: newer }),
  };
}

/** First match wins (spec 0002, R5); selection adds `unavailable` and `pending_activation`. */
function statusOf(
  versionStatus: 'open' | 'closed',
  requirements: readonly RequirementResult[],
  assessments: number,
): EvaluationStatus {
  if (versionStatus === 'closed') return 'unavailable';
  const results = requirements.map((requirement) => requirement.result);
  if (results.includes(false)) return 'not_eligible';
  if (results.includes('unknown')) return 'missing_information';
  return assessments > 0 ? 'needs_assessment' : 'eligible';
}

function unitGaps(unit: Unit): UnitGaps {
  const byPerson = new Map(
    unit.possibleDependents.map((member) => [member.personId, member.missingFacts]),
  );
  const markers = unit.missingMarkers.map((missing): MissingFact => ({
    kind: 'marker',
    ...missing,
  }));
  return {
    member: (personId) => byPerson.get(personId) ?? [],
    all: () => [...unit.possibleDependents.flatMap((member) => member.missingFacts), ...markers],
  };
}

function citations(sources: readonly Source[]): (ids: readonly string[]) => Source[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return (ids) =>
    ids.map((id) => {
      const source = byId.get(id);
      if (source === undefined) throw new RangeError('An unchecked source reference');
      return source;
    });
}

interface Priced {
  readonly applies: Truth;
  readonly amount: NumberValue;
}

function costItems(
  prepared: Prepared,
  frame: Frame,
  unit: Unit,
  cite: (ids: readonly string[]) => Source[],
): { items: CostItem[]; priced: Priced[]; traces: Trace[] } {
  const items: CostItem[] = [];
  const priced: Priced[] = [];
  const traces: Trace[] = [];
  const add = (cost: Cost, payer: Priced, personId?: string): void => {
    priced.push(payer);
    items.push({
      costId: cost.id,
      title: cost.title,
      kind: cost.kind,
      appliesTo: cost.appliesTo,
      ...(personId === undefined ? {} : { personId }),
      applies: payer.applies,
      amount: rounded(payer.amount),
      sources: cite(cost.sources),
    });
  };
  const price = (cost: Cost, at: Frame): { condition: Truth; amount: NumberValue } => {
    const condition = cost.condition === undefined ? undefined : evaluate(cost.condition, at);
    const amount = evaluate(cost.amount, at);
    traces.push(amount, ...(condition === undefined ? [] : [condition]));
    return {
      condition: condition === undefined ? true : truthOf(condition),
      amount: numberOf(amount),
    };
  };
  for (const cost of prepared.version.costs) {
    if (cost.appliesTo !== 'each_dependent') {
      const { condition, amount } = price(cost, frame);
      add(
        cost,
        { applies: condition, amount },
        cost.appliesTo === 'principal' ? prepared.principalId : undefined,
      );
      continue;
    }
    for (const dependent of [...unit.dependents, ...unit.possibleDependents]) {
      // A dependent reached by several edges pays once: the cost applies when it applies through
      // an edge that covers them, and its amount ranges over those edges.
      const perEdge = dependent.edges.map(({ edge, holds }) => {
        const priced = price(cost, { ...frame, current: dependent.personId, edge });
        return { applies: and([holds, priced.condition]), amount: priced.amount };
      });
      const counted = perEdge.filter((entry) => entry.applies !== false);
      const amount = hullNumbers(
        (counted.length > 0 ? counted : perEdge).map((entry) => entry.amount),
      );
      add(cost, { applies: or(perEdge.map((entry) => entry.applies)), amount }, dependent.personId);
    }
  }
  return { items, priced, traces };
}

function totals(
  priced: readonly Priced[],
  unit: Unit,
  costs: readonly Cost[],
  versionCurrency: CurrencyCode,
): CostTotal[] {
  const zero = (currency: CurrencyCode): NumberValue => ({
    type: 'number',
    currency,
    min: zeroBound,
    max: zeroBound,
  });
  const byCurrency = new Map<CurrencyCode, { certain: NumberValue; extra: NumberValue }>();
  if (costs.length > 0) {
    byCurrency.set(versionCurrency, {
      certain: zero(versionCurrency),
      extra: zero(versionCurrency),
    });
  }
  for (const { applies, amount } of priced) {
    if (applies === false) continue;
    const currency = amount.currency;
    if (currency === undefined) throw new RangeError('A cost without a currency');
    const total = byCurrency.get(currency) ?? { certain: zero(currency), extra: zero(currency) };
    byCurrency.set(
      currency,
      applies === true
        ? { ...total, certain: addNumbers(total.certain, amount) }
        : { ...total, extra: addNumbers(total.extra, orZero(amount)) },
    );
  }
  // Unrecorded people in an open unit may each owe a per-dependent cost.
  const openPerDependent = unit.open && costs.some((cost) => cost.appliesTo === 'each_dependent');
  return [...byCurrency].map(([currency, total]) => ({
    currency,
    certain: rounded(total.certain),
    possibleExtra: rounded(
      openPerDependent ? { type: 'number', currency, ...minOnly(total.extra) } : total.extra,
    ),
  }));
}

function minOnly(value: NumberValue): Pick<NumberValue, 'min'> {
  return value.min === undefined ? {} : { min: value.min };
}

function rounded(value: NumberValue): AmountRange {
  const { currency } = value;
  if (currency === undefined) throw new RangeError('A cost without a currency');
  return {
    ...(value.min === undefined ? {} : { min: roundHalfEven({ ...value.min, currency }) }),
    ...(value.max === undefined ? {} : { max: roundHalfEven({ ...value.max, currency }) }),
  };
}

function valueOf(trace: Trace): Value {
  if (trace.value.type === 'set') throw new RangeError('A set where a fact value is needed');
  return trace.value;
}
