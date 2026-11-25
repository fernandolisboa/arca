import type { FamilyPlan } from '@arca/api-contract/client';
import { describe, expect, it } from 'vitest';
import { routeTaken, stagesOf, withMove, withoutMove, writtenMoves } from '../src/plan/moves.js';

type Move = FamilyPlan['moves'][number];

/** A move as the API answers it, with only what these helpers read; IDs are invented. */
const planned = (
  stage: number,
  routeId: string,
  principalId: string,
  taken: readonly string[] = [],
): Move =>
  ({
    stage,
    result: { routeId, principalId },
    dependents: taken.map((personId) => ({ personId, fit: 'covered' })),
  }) as unknown as Move;

const plan = (...moves: Move[]): FamilyPlan =>
  ({
    revision: 'A'.repeat(43),
    rulesAsOf: '2026-11-25',
    moves,
    unplanned: [],
    totals: [],
  }) as unknown as FamilyPlan;

describe('the family plan’s moves on the screen', () => {
  const family = plan(
    planned(1, 'qm-work', 'p1', ['p2']),
    planned(1, 'qm-other', 'p3'),
    planned(2, 'qm-reunion', 'p1', ['p4']),
  );

  it('writes back each move’s stage, route, principal and who it takes', () => {
    expect(writtenMoves(family)).toEqual([
      { stage: 1, routeId: 'qm-work', principalId: 'p1', dependentIds: ['p2'] },
      { stage: 1, routeId: 'qm-other', principalId: 'p3', dependentIds: [] },
      { stage: 2, routeId: 'qm-reunion', principalId: 'p1', dependentIds: ['p4'] },
    ]);
  });

  it('adds, replaces and removes one move', () => {
    const moves = writtenMoves(family);
    const extra = { stage: 3, routeId: 'qm-late', principalId: 'p4', dependentIds: [] };
    expect(withMove(moves, null, extra)).toHaveLength(4);
    expect(withMove(moves, 1, extra)[1]).toEqual(extra);
    expect(withoutMove(moves, 0).map(({ routeId }) => routeId)).toEqual(['qm-other', 'qm-reunion']);
  });

  it('groups the moves by stage, keeping each one’s place in the plan', () => {
    expect(
      stagesOf(family).map(({ stage, moves }) => [stage, moves.map(({ index }) => index)]),
    ).toEqual([
      [1, [0, 1]],
      [2, [2]],
    ]);
  });

  it('tells a route the principal already has from the move being edited', () => {
    const moves = writtenMoves(family);
    expect(routeTaken(moves, null, 'qm-work', 'p1')).toBe(true);
    expect(routeTaken(moves, 0, 'qm-work', 'p1')).toBe(false);
    expect(routeTaken(moves, null, 'qm-work', 'p3')).toBe(false);
  });
});
