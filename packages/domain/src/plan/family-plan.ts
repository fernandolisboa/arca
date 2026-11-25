import type { CaseSnapshot } from '../case/snapshot.js';
import { type RouteResult, type UnitsRange, routeResult, unitsRange } from '../case/results.js';
import type { CurrencyCode } from '../money/currency.js';
import type { Money } from '../money/money.js';
import type { RouteCatalog } from '../rules/catalog.js';
import type { EvaluationContext } from '../rules/context.js';
import { type AmountRange, type CostTotal, evaluateRoute } from '../rules/engine.js';

export const maxPlanMoves = 20;
export const maxPlanStages = 6;

/**
 * One move of a family plan (ADR-0040): a principal applies for a route in a stage, taking the
 * chosen people along. A person may be the principal of a later move too, such as a family
 * reunification once they live there. It records what the family intends; it decides nothing.
 */
export interface PlanMove {
  readonly stage: number;
  readonly routeId: string;
  readonly principalId: string;
  readonly dependentIds: readonly string[];
}

/** What a plan may name: the case's members, its people and the catalog's routes. */
export interface PlanBounds {
  readonly members: ReadonlySet<string>;
  readonly people: ReadonlySet<string>;
  readonly routeIds: ReadonlySet<string>;
}

/**
 * Whether a plan names only what the case and the catalog hold: a member as each principal,
 * other people of the case as dependents, each once, a known route, a stage in range, and one
 * move at most per route and principal.
 */
export function validPlan(moves: readonly PlanMove[], bounds: PlanBounds): boolean {
  if (moves.length > maxPlanMoves) return false;
  if (moves.some((move, at) => moves.findIndex((other) => sameApplication(move, other)) !== at)) {
    return false;
  }
  return moves.every(
    ({ stage, routeId, principalId, dependentIds }) =>
      Number.isInteger(stage) &&
      stage >= 1 &&
      stage <= maxPlanStages &&
      bounds.routeIds.has(routeId) &&
      bounds.members.has(principalId) &&
      new Set(dependentIds).size === dependentIds.length &&
      dependentIds.every((id) => id !== principalId && bounds.people.has(id)),
  );
}

/** Whether two moves are the same application: one route for one principal, once per plan. */
export function sameApplication(
  left: Pick<PlanMove, 'routeId' | 'principalId'>,
  right: Pick<PlanMove, 'routeId' | 'principalId'>,
): boolean {
  return left.routeId === right.routeId && left.principalId === right.principalId;
}

/**
 * Whether a route takes a person along as the engine found it: `unknown` when no version was
 * evaluated, so nothing was found either way.
 */
export const dependentFits = ['covered', 'possible', 'not_covered', 'unknown'] as const;
export type DependentFit = (typeof dependentFits)[number];

export function dependentFit(
  result: Pick<RouteResult, 'status' | 'version' | 'dependents' | 'possibleDependents'>,
  personId: string,
): DependentFit {
  if (result.version === null || result.status === 'pending_activation') return 'unknown';
  if (result.dependents.includes(personId)) return 'covered';
  return result.possibleDependents.includes(personId) ? 'possible' : 'not_covered';
}

export interface PlannedMove {
  readonly stage: number;
  /** The route evaluated for the principal with only the chosen people in the unit. */
  readonly result: RouteResult;
  readonly dependents: readonly { readonly personId: string; readonly fit: DependentFit }[];
  /**
   * The first earlier stage in which the principal already goes, as principal or taken along:
   * someone who moved first and now applies for the people who join them. Null when none.
   */
  readonly principalGoesFrom: number | null;
}

export interface PlanTotal {
  readonly currency: string;
  readonly certain: UnitsRange;
  readonly possibleExtra: UnitsRange;
}

export interface EvaluatedPlan {
  /** The moves by stage, in the order the family put them in within a stage. */
  readonly moves: readonly PlannedMove[];
  /** Members of the case in no move, neither as principal nor taken along. */
  readonly unplanned: readonly string[];
  /** Every move's cost added up per currency, as each route's own total gives it. */
  readonly totals: readonly PlanTotal[];
}

/**
 * Evaluates each move of a plan the family stored (ADR-0040): the route for its principal, with
 * the unit limited to the people the move takes, so the requirements and costs count only them.
 * The plan must be valid for the snapshot, which the caller checks with {@link validPlan}.
 */
export function evaluatePlan(
  snapshot: CaseSnapshot,
  catalog: RouteCatalog,
  moves: readonly PlanMove[],
  context: EvaluationContext,
): EvaluatedPlan {
  const ordered = [...moves].sort((left, right) => left.stage - right.stage);
  const evaluated = ordered.map((move) => {
    const outcome = evaluateRoute(snapshot, catalog, move.routeId, move.principalId, {
      ...context,
      chosenDependents: move.dependentIds,
    });
    const result = routeResult(outcome, move.principalId);
    return {
      planned: {
        stage: move.stage,
        result,
        dependents: move.dependentIds.map((personId) => ({
          personId,
          fit: dependentFit(result, personId),
        })),
        principalGoesFrom: firstStageOf(moves, move.principalId, move.stage),
      },
      // A closed route takes no application, so its fees are no part of what the plan costs.
      totals:
        result.status === 'unavailable' || outcome.kind !== 'evaluated'
          ? []
          : outcome.evaluation.totals,
    };
  });
  const placed = new Set(moves.flatMap((move) => [move.principalId, ...move.dependentIds]));
  return {
    moves: evaluated.map(({ planned }) => planned),
    unplanned: snapshot.members.filter((id) => !placed.has(id)),
    totals: addedTotals(evaluated.flatMap(({ totals }) => totals)),
  };
}

function firstStageOf(moves: readonly PlanMove[], personId: string, before: number): number | null {
  const stages = moves
    .filter(
      (move) =>
        move.stage < before &&
        (move.principalId === personId || move.dependentIds.includes(personId)),
    )
    .map(({ stage }) => stage);
  return stages.length === 0 ? null : Math.min(...stages);
}

/** Totals added per currency; an open bound in any of them leaves the sum's bound open. */
function addedTotals(totals: readonly CostTotal[]): PlanTotal[] {
  const byCurrency = new Map<CurrencyCode, { certain: AmountRange; possibleExtra: AmountRange }>();
  for (const total of totals) {
    const sum = byCurrency.get(total.currency);
    byCurrency.set(
      total.currency,
      sum === undefined
        ? { certain: total.certain, possibleExtra: total.possibleExtra }
        : {
            certain: addRanges(sum.certain, total.certain),
            possibleExtra: addRanges(sum.possibleExtra, total.possibleExtra),
          },
    );
  }
  return [...byCurrency]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, { certain, possibleExtra }]) => ({
      currency,
      certain: unitsRange(certain),
      possibleExtra: unitsRange(possibleExtra),
    }));
}

function addRanges(left: AmountRange, right: AmountRange): AmountRange {
  const min = addMoney(left.min, right.min);
  const max = addMoney(left.max, right.max);
  return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
}

function addMoney(left: Money | undefined, right: Money | undefined): Money | undefined {
  if (left === undefined || right === undefined) return undefined;
  if (left.currency !== right.currency) throw new RangeError('Totals of one currency are added');
  const amount = left.amount + right.amount;
  if (!Number.isSafeInteger(amount)) throw new RangeError('A plan total beyond the safe range');
  return { amount, currency: left.currency };
}
