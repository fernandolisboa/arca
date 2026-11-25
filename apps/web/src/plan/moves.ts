import {
  type FamilyPlan,
  type WriteFamilyPlanRequest,
  sameApplication,
} from '@arca/api-contract/client';

export type WrittenMove = WriteFamilyPlanRequest['moves'][number];

/** The plan as the API takes it back: each move's stage, route, principal and who it takes. */
export function writtenMoves(plan: FamilyPlan): WrittenMove[] {
  return plan.moves.map(({ stage, result, dependents }) => ({
    stage,
    routeId: result.routeId,
    principalId: result.principalId,
    dependentIds: dependents.map(({ personId }) => personId),
  }));
}

/** The moves with one replaced, or added at the end when `index` is null. */
export function withMove(
  moves: readonly WrittenMove[],
  index: number | null,
  move: WrittenMove,
): WrittenMove[] {
  return index === null ? [...moves, move] : moves.map((each, at) => (at === index ? move : each));
}

export function withoutMove(moves: readonly WrittenMove[], index: number): WrittenMove[] {
  return moves.filter((_, at) => at !== index);
}

/** The plan's moves grouped by stage, each with its place in the plan. */
export function stagesOf(plan: FamilyPlan): {
  readonly stage: number;
  readonly moves: { readonly index: number; readonly move: FamilyPlan['moves'][number] }[];
}[] {
  const grouped = Map.groupBy(
    plan.moves.map((move, index) => ({ index, move })),
    ({ move }) => move.stage,
  );
  return [...grouped]
    .sort(([left], [right]) => left - right)
    .map(([stage, moves]) => ({ stage, moves }));
}

/** Whether the plan already has this route for this principal, outside the move being edited. */
export function routeTaken(
  moves: readonly WrittenMove[],
  editing: number | null,
  routeId: string,
  principalId: string,
): boolean {
  return moves.some(
    (move, at) => at !== editing && sameApplication(move, { routeId, principalId }),
  );
}
