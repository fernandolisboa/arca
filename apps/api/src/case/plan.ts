import type { WriteFamilyPlanRequest } from '@arca/api-contract/routes';
import type { Transaction } from '@arca/db';
import { type PlanMove, evaluatePlan, validPlan } from '@arca/domain';
import { sql } from 'drizzle-orm';
import { viewedSnapshot } from './case-snapshot.js';
import { type EvaluationSettings, evaluationContext, resultView } from './evaluations.js';
import type { CaseRows } from './view.js';

/** A move as the case stores it, with the case's own person UUIDs. */
export type StoredPlanMove = WriteFamilyPlanRequest['moves'][number];

/** The case's family plan as row-level security shows it to a member, in the order written. */
export async function readPlan(tx: Transaction, caseId: string): Promise<StoredPlanMove[]> {
  const moves = await tx.execute<{
    id: string;
    stage: number;
    route_id: string;
    principal_id: string;
  }>(sql`
    SELECT id, stage, route_id, principal_id FROM cases.plan_move
     WHERE case_id = ${caseId} ORDER BY position`);
  const taken = await tx.execute<{ move_id: string; person_id: string }>(sql`
    SELECT move_id, person_id FROM cases.plan_move_dependent WHERE case_id = ${caseId}`);
  return moves.rows.map((move) => ({
    stage: move.stage,
    routeId: move.route_id,
    principalId: move.principal_id,
    dependentIds: taken.rows
      .filter(({ move_id: moveId }) => moveId === move.id)
      .map(({ person_id: personId }) => personId),
  }));
}

/**
 * Whether the plan names only the case's people and the catalog's routes (ADR-0040): every
 * member sees every person of the case, so the check sees what it checks.
 */
export function planFitsCase(
  rows: CaseRows,
  moves: readonly StoredPlanMove[],
  routeIds: readonly string[],
): boolean {
  return validPlan(moves, {
    members: new Set(rows.people.filter((person) => person.caseMember).map(({ id }) => id)),
    people: new Set(rows.people.map(({ id }) => id)),
    routeIds: new Set(routeIds),
  });
}

/** Replaces the case's plan; the caller holds the case's lock and checked the plan fits it. */
export async function savePlan(
  tx: Transaction,
  caseId: string,
  moves: readonly StoredPlanMove[],
): Promise<void> {
  await tx.execute(sql`DELETE FROM cases.plan_move WHERE case_id = ${caseId}`);
  for (const [position, move] of moves.entries()) {
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO cases.plan_move (case_id, position, stage, route_id, principal_id)
      VALUES (${caseId}, ${position}, ${move.stage}, ${move.routeId}, ${move.principalId})
      RETURNING id`);
    const moveId = inserted.rows[0]?.id;
    if (moveId === undefined) throw new Error('A plan move was not stored');
    if (move.dependentIds.length === 0) continue;
    await tx.execute(sql`
      INSERT INTO cases.plan_move_dependent (move_id, case_id, person_id)
      VALUES ${sql.join(
        move.dependentIds.map((personId) => sql`(${moveId}, ${caseId}, ${personId})`),
        sql`, `,
      )}`);
  }
}

/**
 * The plan evaluated from what the viewer sees (ADR-0040): each move's route for its principal
 * with only the people it takes. A move whose principal has since left the planning is not
 * shown, and the next write drops it. Nothing here is stored or logged.
 */
export function familyPlan(
  rows: CaseRows,
  stored: readonly StoredPlanMove[],
  settings: Omit<EvaluationSettings, 'routeIds'>,
) {
  const { snapshot, personIds, uuid } = viewedSnapshot(rows, settings.today);
  const opaque = (id: string) => personIds.get(id);
  const moves = stored.flatMap((move): PlanMove[] => {
    const principalId = opaque(move.principalId);
    if (principalId === undefined || !snapshot.members.includes(principalId)) return [];
    return [
      {
        stage: move.stage,
        routeId: move.routeId,
        principalId,
        dependentIds: move.dependentIds.flatMap((id) => opaque(id) ?? []),
      },
    ];
  });
  const plan = evaluatePlan(snapshot, settings.catalog, moves, evaluationContext(settings));
  const view = resultView({ ...settings, uuid });
  return {
    rulesAsOf: settings.today,
    moves: plan.moves.map((move) => ({
      stage: move.stage,
      result: view(move.result),
      dependents: move.dependents.map(({ personId, coverage }) => ({
        personId: uuid(personId),
        coverage,
      })),
    })),
    unplanned: plan.unplanned.map(uuid),
    totals: plan.totals,
  };
}

export type FamilyPlanView = ReturnType<typeof familyPlan>;
