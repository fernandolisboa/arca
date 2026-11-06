import type { CalendarDate } from '../calendar/calendar-date.js';
import type { Truth } from '../logic/truth.js';
import { unitsAmount } from '../money/currency.js';
import type { Money } from '../money/money.js';
import type { EvaluationStatus, RouteEvaluation } from '../rules/engine.js';
import { resolveFactReference } from '../rules/fact-reference.js';
import type { MissingFact } from '../rules/missing.js';
import type { Source } from '../rules/route-version.js';
import type { FactKey } from './facts.js';
import { type QuestionId, questionIds } from './questions.js';

/** The guided question that sets each fact the rules read (spec 0007, R4 and R6). */
export const questionForFact = {
  'person.birthDate': 'birthDate',
  'person.ageYears': 'birthDate',
  'person.citizenships': 'citizenships',
  'person.residenceCountry': 'residenceCountry',
  'person.educationLevel': 'educationLevel',
  'person.monthlyActiveIncome': 'incomes',
  'person.monthlyPassiveIncome': 'incomes',
  'person.liquidAssets': 'assets',
  'person.visaRefusals': 'immigrationHistory',
  'person.dependsOnPrincipal': 'dependsOn',
  'person.studying': 'studying',
  'person.hasSpouse': 'relationships',
  'person.temporaryJobOfferSectors': 'jobOffers',
  'unit.liquidAssets': 'assets',
  'edge.parentKind': 'relationships',
  'edge.custody': 'relationships',
  'edge.start': 'relationships',
  'edge.ageAtStart': 'relationships',
  'edge.custodyStart': 'relationships',
  'edge.end': 'relationships',
  'edge.dependsOnLinkedPerson': 'dependsOn',
  'lineage.generation': 'relationships',
  'lineage.edgeKind': 'relationships',
  'lineage.childBirthDate': 'birthDate',
  'lineage.citizenshipsAtChildBirth': 'citizenships',
} as const satisfies Record<FactKey, QuestionId>;

const questionForMarker = {
  spouses: 'allSpouses',
  partners: 'allPartners',
  children: 'allChildren',
  parents: 'allParents',
  assets: 'allAssets',
} as const satisfies Record<string, QuestionId>;

/** A question that could decide results: the viewer answers it, or asks the person's keeper. */
export interface DecisiveQuestion {
  readonly personId: string;
  readonly question: QuestionId;
  /** How many route and principal pairs it could decide. */
  readonly decides: number;
  /** The viewer keeps the person, so they answer; otherwise they ask whoever keeps them. */
  readonly kept: boolean;
}

/** Who answers a missing fact, and with which question. */
function asked(
  missing: MissingFact,
  kept: ReadonlySet<string>,
): { readonly personId: string; readonly question: QuestionId } | undefined {
  switch (missing.kind) {
    case 'fact': {
      const resolved = resolveFactReference(missing.reference);
      if (resolved === undefined) return undefined;
      return { personId: missing.personId, question: questionForFact[resolved.key] };
    }
    case 'marker':
      return { personId: missing.personId, question: questionForMarker[missing.marker] };
    case 'relationship': {
      const { edge } = missing;
      const ends = edge.kind === 'parent' ? [edge.child, edge.parent] : [...edge.people];
      const personId = ends.find((end) => kept.has(end)) ?? ends[0];
      return personId === undefined ? undefined : { personId, question: 'relationships' };
    }
  }
}

const flowOrder = new Map(questionIds.map((id, index) => [id, index]));

/**
 * Only the questions that change an answer (spec 0007, R6): each decisive missing fact of each
 * route and principal pair becomes the question that sets it, counted once per pair, ordered by
 * how many pairs it could decide, then by the guided flow's order.
 */
export function decisiveQuestions(
  results: readonly { readonly missingFacts: readonly MissingFact[] }[],
  kept: ReadonlySet<string>,
): DecisiveQuestion[] {
  const counted = new Map<string, { personId: string; question: QuestionId; decides: number }>();
  for (const { missingFacts } of results) {
    const keys = new Set<string>();
    for (const missing of missingFacts) {
      const question = asked(missing, kept);
      if (question === undefined) continue;
      const key = `${question.question}\u0000${question.personId}`;
      if (keys.has(key)) continue;
      keys.add(key);
      const entry = counted.get(key) ?? { ...question, decides: 0 };
      counted.set(key, { ...entry, decides: entry.decides + 1 });
    }
  }
  return [...counted.values()]
    .map((entry) => ({ ...entry, kept: kept.has(entry.personId) }))
    .sort(
      (left, right) =>
        right.decides - left.decides ||
        (flowOrder.get(left.question) ?? 0) - (flowOrder.get(right.question) ?? 0) ||
        left.personId.localeCompare(right.personId),
    );
}

/** An amount in the currency's units, as a decimal. */
export interface UnitsMoney {
  readonly amount: string;
  readonly currency: string;
}

/** One route for one principal as the results screen shows it, without traces (spec 0007, R6). */
export interface RouteResult {
  readonly routeId: string;
  readonly principalId: string;
  readonly status: EvaluationStatus | 'pending_activation';
  /** The version evaluated, or the one waiting for activation; null when none is in effect. */
  readonly version: { readonly number: number; readonly hash: string } | null;
  readonly stale: boolean;
  readonly newerProposedVersion: { readonly number: number; readonly from: CalendarDate } | null;
  readonly dependents: readonly string[];
  readonly possibleDependents: readonly string[];
  /** People not recorded may still go: a completeness marker or a reference date is missing. */
  readonly unitOpen: boolean;
  readonly requirements: readonly {
    readonly id: string;
    readonly title: string;
    readonly result: Truth;
    readonly sources: readonly Source[];
  }[];
  readonly assessments: readonly {
    readonly id: string;
    readonly title: string;
    readonly sources: readonly Source[];
  }[];
  readonly costs: readonly {
    readonly costId: string;
    readonly title: string;
    readonly appliesTo: string;
    readonly personId: string | null;
    readonly applies: Truth;
    readonly min: UnitsMoney | null;
    readonly max: UnitsMoney | null;
    readonly sources: readonly Source[];
  }[];
  readonly durations: readonly {
    readonly id: string;
    readonly title: string;
    readonly min: string;
    readonly max: string;
    readonly sources: readonly Source[];
  }[];
  /** What would settle the status or the unit: the decisive facts and the possible dependents'. */
  readonly missingFacts: readonly MissingFact[];
}

const unitsMoney = (money: Money | undefined): UnitsMoney | null =>
  money === undefined
    ? null
    : {
        amount: unitsAmount(money.amount, money.currency),
        currency: money.currency,
      };

/** A route evaluation laid out for the results screen, with the case's IDs left as they are. */
export function routeResult(evaluated: RouteEvaluation, principalId: string): RouteResult {
  const empty = {
    routeId: evaluated.kind === 'evaluated' ? evaluated.evaluation.routeId : evaluated.routeId,
    principalId,
    status: evaluated.status,
    stale: false,
    newerProposedVersion: null,
    dependents: [],
    possibleDependents: [],
    unitOpen: false,
    requirements: [],
    assessments: [],
    costs: [],
    durations: [],
    missingFacts: [],
  };
  if (evaluated.kind === 'no_version') return { ...empty, version: null };
  if (evaluated.kind === 'pending') {
    return {
      ...empty,
      version: { number: evaluated.pending.number, hash: evaluated.pending.hash },
    };
  }
  const { evaluation } = evaluated;
  const { unit } = evaluation;
  return {
    ...empty,
    version: { number: evaluation.versionNumber, hash: evaluation.hash },
    stale: evaluated.stale,
    newerProposedVersion:
      evaluated.newerProposedVersion === undefined
        ? null
        : {
            number: evaluated.newerProposedVersion.identity.number,
            from: evaluated.newerProposedVersion.from,
          },
    dependents: unit.dependents.map((dependent) => dependent.personId),
    possibleDependents: unit.possibleDependents.map((dependent) => dependent.personId),
    unitOpen: unit.open,
    requirements: evaluation.requirements.map(({ id, title, result, sources }) => ({
      id,
      title,
      result,
      sources,
    })),
    assessments: evaluation.assessments.map(({ id, title, sources }) => ({ id, title, sources })),
    costs: evaluation.costs.map((cost) => ({
      costId: cost.costId,
      title: cost.title,
      appliesTo: cost.appliesTo,
      personId: cost.personId ?? null,
      applies: cost.applies,
      min: unitsMoney(cost.amount.min),
      max: unitsMoney(cost.amount.max),
      sources: cost.sources,
    })),
    durations: evaluation.durations.map(({ id, title, min, max, sources }) => ({
      id,
      title,
      min,
      max,
      sources,
    })),
    // What settles the status, and who goes with whom.
    missingFacts: [
      ...evaluation.missingFacts,
      ...unit.possibleDependents.flatMap((dependent) => dependent.missingFacts),
      ...unit.missingMarkers.map((marker) => ({ kind: 'marker' as const, ...marker })),
    ],
  };
}
