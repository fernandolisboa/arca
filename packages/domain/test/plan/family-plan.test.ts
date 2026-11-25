import { describe, expect, it } from 'vitest';
import type { CaseSnapshot } from '../../src/case/snapshot.js';
import {
  type PlanMove,
  evaluatePlan,
  maxPlanMoves,
  validPlan,
} from '../../src/plan/family-plan.js';
import { type RouteCatalog, identityKey } from '../../src/rules/catalog.js';
import { snapshot } from '../case/builders.js';
import { context, entry } from '../rules/fixtures.js';

const everything = ['spouses', 'partners', 'children', 'parents', 'assets'];

/** A synthetic couple and the wife's parents: every value is invented. */
function family(): CaseSnapshot {
  return snapshot({
    members: ['p1', 'p2', 'p3', 'p4'],
    people: [
      { id: 'p1', birthDate: '1990-01-01', recordedInFull: everything },
      { id: 'p2', birthDate: '1991-01-01', recordedInFull: everything },
      { id: 'p3', birthDate: '1960-01-01', recordedInFull: everything },
      { id: 'p4', birthDate: '1962-01-01', recordedInFull: everything },
    ],
    relationships: [
      { kind: 'spouse', people: ['p1', 'p2'], start: '2015-01-01', end: 'none' },
      { kind: 'spouse', people: ['p3', 'p4'], start: '1985-01-01', end: 'none' },
      { kind: 'parent', parent: 'p3', child: 'p2', parentKind: 'biological' },
      { kind: 'parent', parent: 'p4', child: 'p2', parentKind: 'biological' },
    ],
    assets: [
      {
        id: 'a1',
        kind: 'cash',
        owners: [{ person: 'p1', share: '1' }],
        value: { amount: 3000_00, currency: 'EUR' },
        valuedAt: '2026-10-01',
        liquid: true,
        sold: 'none',
      },
    ],
  });
}

const sample = entry();
const other = entry({ routeId: 'qm-other', title: 'Another route' });
const catalog: RouteCatalog = {
  identities: (routeId) =>
    [sample, other]
      .filter((each) => each.identity.routeId === routeId)
      .map((each) => each.identity),
  activeEntry: (identity) =>
    [sample, other].find((each) => identityKey(each.identity) === identityKey(identity)),
};
const states = new Map([
  [identityKey(sample.identity), 'active' as const],
  [identityKey(other.identity), 'active' as const],
]);

const move = (patch: Partial<PlanMove> = {}): PlanMove => ({
  stage: 1,
  routeId: 'qm-sample',
  principalId: 'p1',
  dependentIds: ['p2'],
  ...patch,
});

describe('validPlan', () => {
  const bounds = {
    members: new Set(['p1', 'p2', 'p3', 'p4']),
    people: new Set(['p1', 'p2', 'p3', 'p4', 'p5']),
    routeIds: new Set(['qm-sample', 'qm-other']),
  };

  it('accepts moves that name the case and the catalog, a principal again in a later stage', () => {
    expect(
      validPlan(
        [move(), move({ stage: 2, routeId: 'qm-other', dependentIds: ['p3', 'p4', 'p5'] })],
        bounds,
      ),
    ).toBe(true);
  });

  it.each<[string, readonly PlanMove[]]>([
    ['an unknown route', [move({ routeId: 'qm-missing' })]],
    ['a principal outside the planning', [move({ principalId: 'p5', dependentIds: [] })]],
    ['a dependent outside the case', [move({ dependentIds: ['p9'] })]],
    ['the principal taken along', [move({ dependentIds: ['p1'] })]],
    ['someone taken twice', [move({ dependentIds: ['p2', 'p2'] })]],
    ['stage 0', [move({ stage: 0 })]],
    ['a stage past the last', [move({ stage: 7 })]],
    ['a fractional stage', [move({ stage: 1.5 })]],
    ['the same route twice for one principal', [move(), move({ stage: 2, dependentIds: [] })]],
    ['too many moves', Array.from({ length: maxPlanMoves + 1 }, () => move())],
  ])('refuses %s', (_label, moves) => {
    expect(validPlan(moves, bounds)).toBe(false);
  });
});

describe('evaluatePlan', () => {
  const evaluated = (moves: readonly PlanMove[]) =>
    evaluatePlan(family(), catalog, moves, context({ states }));

  it('evaluates each move with only the people it takes, by stage', () => {
    const plan = evaluated([
      move({ stage: 2, routeId: 'qm-other', principalId: 'p3', dependentIds: ['p4'] }),
      move(),
    ]);
    expect(
      plan.moves.map(({ stage, result }) => [stage, result.routeId, result.principalId]),
    ).toEqual([
      [1, 'qm-sample', 'p1'],
      [2, 'qm-other', 'p3'],
    ]);
    expect(plan.moves[0]?.result.dependents).toEqual(['p2']);
    expect(plan.moves[0]?.dependents).toEqual([{ personId: 'p2', coverage: 'covered' }]);
    expect(plan.unplanned).toEqual([]);
  });

  it('says when the route may or does not take a chosen person', () => {
    const [planned] = evaluated([move({ dependentIds: ['p3', 'p2'] })]).moves;
    // A parent goes only when dependent on the principal, which the case does not say.
    expect(planned?.dependents).toEqual([
      { personId: 'p3', coverage: 'not_covered' },
      { personId: 'p2', coverage: 'covered' },
    ]);
  });

  it('lists the members in no move', () => {
    expect(evaluated([move()]).unplanned).toEqual(['p3', 'p4']);
    expect(evaluated([]).unplanned).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('adds every move’s total per currency', () => {
    const plan = evaluated([
      move(),
      move({ stage: 2, routeId: 'qm-other', principalId: 'p3', dependentIds: ['p4'] }),
    ]);
    // Each move: a 100.00 fee for the principal and 50.00 for the one person taken.
    expect(plan.totals).toEqual([
      {
        currency: 'EUR',
        certain: {
          min: { amount: '300', currency: 'EUR' },
          max: { amount: '300', currency: 'EUR' },
        },
        possibleExtra: {
          min: { amount: '0', currency: 'EUR' },
          max: { amount: '0', currency: 'EUR' },
        },
      },
    ]);
  });

  it('adds nothing for a route with no version in effect', () => {
    const plan = evaluatePlan(family(), catalog, [move()], context({ states: new Map() }));
    expect(plan.moves[0]?.result.status).toBe('pending_activation');
    expect(plan.totals).toEqual([]);
  });
});
