import type { FactEnvironment } from '../case/facts.js';
import type { MissingMarker } from '../case/graph.js';
import { followPath } from '../case/paths.js';
import type { CaseSnapshot, Relationship } from '../case/snapshot.js';
import type { CurrencyPair } from '../money/fx.js';
import { type Truth, and, or } from '../logic/truth.js';
import type { CatalogEntry } from './catalog.js';
import { type Prepared, type VersionContext, environmentOf, prepare } from './context.js';
import { type Trace, evaluate, truthOf } from './evaluate.js';
import { type MissingFact, decisiveFacts, distinct, traceGaps } from './missing.js';

/**
 * A dependent: the rules that cover them, and each last edge they were reached by with whether
 * some rule covers them through it.
 */
export interface Dependent {
  readonly personId: string;
  readonly rules: readonly string[];
  readonly edges: readonly { readonly edge: Relationship; readonly holds: Truth }[];
}

/** A possible dependent and what would settle it. */
export interface PossibleDependent extends Dependent {
  readonly missingFacts: readonly MissingFact[];
}

/**
 * Someone the version does not cover: no rule's path reaches them, no condition holds, or, while
 * any dependent rule lacks its reference date, nobody can be ruled out.
 */
export interface ExcludedPerson {
  readonly personId: string;
  readonly reason: 'not_related' | 'condition_not_met' | 'reference_date_missing';
}

/**
 * The people who travel with the principal on one route version (spec 0002, R5). Computed per
 * evaluation and never stored. An open unit may hold people who are not recorded, for want of the
 * listed markers or of a reference date a rule reads.
 */
export interface Unit {
  readonly principalId: string;
  readonly dependents: readonly Dependent[];
  readonly possibleDependents: readonly PossibleDependent[];
  readonly excluded: readonly ExcludedPerson[];
  readonly open: boolean;
  readonly missingMarkers: readonly MissingMarker[];
  /** Reference dates the dependent rules needed and the context lacks. */
  readonly missingDates: readonly string[];
  /** FX rates the dependent conditions needed and the table lacks. */
  readonly missingRates: readonly CurrencyPair[];
}

export function computeUnit(
  snapshot: CaseSnapshot,
  entry: CatalogEntry,
  principalId: string,
  context: VersionContext,
): Unit {
  return unitOf(prepare(snapshot, entry, principalId, context)).unit;
}

interface Candidate {
  truth: Truth;
  rules: Set<string>;
  edges: Map<Relationship, Truth>;
  gaps: MissingFact[];
}

const refuseUnitFacts = (): never => {
  throw new RangeError('A dependent rule reads the unit');
};
const noUnitFacts = { member: refuseUnitFacts, all: refuseUnitFacts };

/** The unit and the traces of the dependent conditions, which the evaluation reads gaps from. */
export function unitOf(prepared: Prepared): { unit: Unit; traces: readonly Trace[] } {
  const { indexed, version, principalId } = prepared;
  const environment = environmentOf(prepared);
  const candidates = new Map<string, Candidate>();
  const markers = new Map<string, MissingMarker>();
  const traces: Trace[] = [];
  const unreadDates = new Set<string>();

  for (const rule of version.dependents) {
    const date = rule.at === undefined ? prepared.factsAsOf : prepared.referenceDates.get(rule.at);
    if (date === undefined) {
      if (rule.at !== undefined) unreadDates.add(rule.at);
      continue;
    }
    const { reached, missingMarkers } = followPath(indexed, principalId, rule.path, date);
    for (const missing of missingMarkers) {
      markers.set(`${missing.personId}:${missing.marker}`, missing);
    }
    for (const person of reached) {
      const candidate = candidates.get(person.id) ?? {
        truth: false,
        rules: new Set<string>(),
        edges: new Map<Relationship, Truth>(),
        gaps: [],
      };
      for (const arrival of person.arrivals) {
        const trace = evaluate(rule.condition, {
          environment,
          at: date,
          referenceDates: prepared.referenceDates,
          countrySets: prepared.countrySets,
          current: person.id,
          edge: arrival.edge,
        });
        traces.push(trace);
        const condition = truthOf(trace);
        const truth = and([arrival.reached, condition]);
        if (truth === false) continue;
        candidate.truth = or([candidate.truth, truth]);
        candidate.rules.add(rule.id);
        candidate.edges.set(arrival.edge, or([candidate.edges.get(arrival.edge) ?? false, truth]));
        if (truth === 'unknown') {
          if (arrival.reached === 'unknown') {
            candidate.gaps.push(
              ...arrival.uncertainEdges.map((edge): MissingFact => ({
                kind: 'relationship',
                edge,
              })),
            );
          }
          if (condition === 'unknown') candidate.gaps.push(...decisiveFacts(trace, noUnitFacts));
        }
      }
      candidates.set(person.id, candidate);
    }
  }

  const dependents: Dependent[] = [];
  const possibleDependents: PossibleDependent[] = [];
  const excluded: ExcludedPerson[] = [];
  for (const { id } of indexed.snapshot.people) {
    if (id === principalId) continue;
    const candidate = candidates.get(id);
    const member = {
      personId: id,
      rules: [...(candidate?.rules ?? [])],
      edges: [...(candidate?.edges ?? [])].map(([edge, holds]) => ({ edge, holds })),
    };
    if (candidate?.truth === true) dependents.push(member);
    else if (candidate?.truth === 'unknown') {
      possibleDependents.push({ ...member, missingFacts: distinct(candidate.gaps) });
    } else {
      excluded.push({
        personId: id,
        reason:
          unreadDates.size > 0
            ? 'reference_date_missing'
            : candidate === undefined
              ? 'not_related'
              : 'condition_not_met',
      });
    }
  }
  const gaps = traceGaps(traces);
  const missingMarkers = [...markers.values()];
  const unit: Unit = {
    principalId,
    dependents,
    possibleDependents,
    excluded,
    open: missingMarkers.length > 0 || unreadDates.size > 0,
    missingMarkers,
    missingDates: [...new Set([...gaps.missingDates, ...unreadDates])],
    missingRates: gaps.missingRates,
  };
  return { unit, traces };
}

/** The unit as facts read it: the principal is included. */
export function unitEnvironment(unit: Unit): NonNullable<FactEnvironment['unit']> {
  return {
    included: [unit.principalId, ...unit.dependents.map((member) => member.personId)],
    possible: unit.possibleDependents.map((member) => member.personId),
    open: unit.open,
    missingMarkers: unit.missingMarkers,
  };
}
