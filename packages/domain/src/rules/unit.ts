import type { FactEnvironment } from '../case/facts.js';
import { type MissingMarker, followPath } from '../case/paths.js';
import type { CaseSnapshot, Relationship } from '../case/snapshot.js';
import { type Truth, and, or } from '../logic/truth.js';
import type { CatalogEntry } from './catalog.js';
import { type EvaluationContext, type Prepared, environmentOf, prepare } from './context.js';
import { type Trace, evaluate, truthOf } from './evaluate.js';
import { type MissingFact, type TraceGaps, decisiveFacts, distinct, traceGaps } from './missing.js';

/** A person the version covers, with the dependent rules and last edges that cover them. */
export interface UnitMember {
  readonly personId: string;
  readonly rules: readonly string[];
  readonly edges: readonly Relationship[];
}

/** A person the version might cover, and what would settle it. */
export interface PossibleMember extends UnitMember {
  readonly missingFacts: readonly MissingFact[];
}

/** Someone the version does not cover: no rule's path reaches them, or no condition holds. */
export interface OutsideUnit {
  readonly personId: string;
  readonly reason: 'not_related' | 'condition_not_met';
}

/**
 * The people who travel with the principal on one route version (spec 0002, R5). Computed per
 * evaluation and never stored. An open unit may hold people who are not recorded, for want of the
 * listed markers or of a reference date a rule reads.
 */
export interface Unit extends TraceGaps {
  readonly principalId: string;
  readonly included: readonly UnitMember[];
  readonly possible: readonly PossibleMember[];
  readonly excluded: readonly OutsideUnit[];
  readonly open: boolean;
  readonly missingMarkers: readonly MissingMarker[];
  readonly traces: readonly Trace[];
}

export function computeUnit(
  snapshot: CaseSnapshot,
  entry: CatalogEntry,
  principalId: string,
  context: EvaluationContext,
): Unit {
  return unitOf(prepare(snapshot, entry, principalId, context));
}

interface Candidate {
  truth: Truth;
  rules: Set<string>;
  edges: Set<Relationship>;
  gaps: MissingFact[];
}

const noUnitFacts = {
  member: (): never => {
    throw new RangeError('A dependent rule reads the unit');
  },
  all: (): never => {
    throw new RangeError('A dependent rule reads the unit');
  },
};

export function unitOf(prepared: Prepared): Unit {
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
        edges: new Set<Relationship>(),
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
        candidate.edges.add(arrival.edge);
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

  const included: UnitMember[] = [];
  const possible: PossibleMember[] = [];
  const excluded: OutsideUnit[] = [];
  for (const { id } of indexed.snapshot.people) {
    if (id === principalId) continue;
    const candidate = candidates.get(id);
    const member = {
      personId: id,
      rules: [...(candidate?.rules ?? [])],
      edges: [...(candidate?.edges ?? [])],
    };
    if (candidate?.truth === true) included.push(member);
    else if (candidate?.truth === 'unknown') {
      possible.push({ ...member, missingFacts: distinct(candidate.gaps) });
    } else {
      excluded.push({
        personId: id,
        reason: candidate === undefined ? 'not_related' : 'condition_not_met',
      });
    }
  }
  const gaps = traceGaps(traces);
  const missingMarkers = [...markers.values()];
  return {
    principalId,
    included,
    possible,
    excluded,
    open: missingMarkers.length > 0 || unreadDates.size > 0,
    missingMarkers,
    missingRates: gaps.missingRates,
    missingDates: [...new Set([...gaps.missingDates, ...unreadDates])],
    rates: gaps.rates,
    traces,
  };
}

/** The unit as facts read it: the principal among the included. */
export function unitEnvironment(unit: Unit): NonNullable<FactEnvironment['unit']> {
  return {
    included: [unit.principalId, ...unit.included.map((member) => member.personId)],
    possible: unit.possible.map((member) => member.personId),
    open: unit.open,
    missingMarkers: unit.missingMarkers,
  };
}
