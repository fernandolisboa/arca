import { describe, expect, it, vi } from 'vitest';
import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import type { CaseSnapshot } from '../../src/case/snapshot.js';
import {
  type DecisionStates,
  type RouteCatalog,
  type VersionIdentity,
  identityKey,
} from '../../src/rules/catalog.js';
import { evaluateRoute, evaluateVersion } from '../../src/rules/engine.js';
import type { Trace } from '../../src/rules/evaluate.js';
import { nodeCount } from '../../src/rules/expression.js';
import { computeUnit } from '../../src/rules/unit.js';
import { snapshot } from '../case/builders.js';
import { context, entry, sampleVersion } from './fixtures.js';

const everything = ['spouses', 'partners', 'children', 'parents', 'assets'];

/** A synthetic person recorded in full, so only what a test leaves out is unknown. */
const known = (id: string, birthDate: string, extra: object = {}): object => ({
  id,
  birthDate,
  recordedInFull: everything,
  ...extra,
});

const cash = (owner: string, amount: number): object => ({
  id: `a${owner.slice(1)}`,
  kind: 'cash',
  owners: [{ person: owner, share: '1' }],
  value: { amount, currency: 'EUR' },
  valuedAt: '2026-10-01',
  liquid: true,
  sold: 'none',
});

/** A synthetic family: every value is invented. */
function family(): CaseSnapshot {
  return snapshot({
    members: ['p1', 'p2', 'p4', 'p6'],
    people: [
      known('p1', '1980-01-01'),
      known('p2', '1982-01-01'),
      known('p3', '1979-01-01'),
      known('p4', '2010-05-01'),
      known('p5', '2000-01-01'),
      { id: 'p6' },
      known('p7', '1950-01-01', { financiallyDependentOn: ['p1'] }),
      known('p8', '1952-01-01'),
    ],
    relationships: [
      { kind: 'spouse', people: ['p1', 'p2'], start: '2005-01-01', end: 'none' },
      { kind: 'spouse', people: ['p1', 'p3'], start: '2000-01-01', end: '2003-01-01' },
      { kind: 'parent', parent: 'p1', child: 'p4', parentKind: 'biological' },
      { kind: 'parent', parent: 'p1', child: 'p5', parentKind: 'biological' },
      { kind: 'parent', parent: 'p1', child: 'p6', parentKind: 'biological' },
      { kind: 'parent', parent: 'p7', child: 'p1', parentKind: 'biological' },
      { kind: 'parent', parent: 'p8', child: 'p1', parentKind: 'biological' },
    ],
    assets: [cash('p1', 3000_00)],
  });
}

function alone(amount: number, birthDate = '1980-01-01'): CaseSnapshot {
  return snapshot({ people: [known('p1', birthDate)], assets: [cash('p1', amount)] });
}

describe('computeUnit', () => {
  const unit = computeUnit(family(), entry(), 'p1', context());

  it('includes who the rules cover, each once, with the rules and edges that cover them', () => {
    expect(unit.included.map((member) => [member.personId, member.rules])).toEqual([
      ['p2', ['spouse']],
      ['p4', ['children']],
      ['p7', ['parents']],
    ]);
    expect(unit.included[0]?.edges).toHaveLength(1);
  });

  it('lists possible dependents with what would settle them', () => {
    expect(unit.possible.map((member) => member.personId)).toEqual(['p6', 'p8']);
    expect(unit.possible[0]?.missingFacts).toEqual([
      { kind: 'fact', reference: 'person.ageYears', personId: 'p6' },
      { kind: 'marker', personId: 'p6', marker: 'spouses' },
      { kind: 'fact', reference: 'person.hasSpouse', personId: 'p6' },
    ]);
    expect(unit.possible[1]?.missingFacts).toEqual([
      { kind: 'fact', reference: 'person.dependsOnPrincipal', personId: 'p8' },
    ]);
  });

  it('puts everyone else out, with the reason', () => {
    expect(unit.excluded).toEqual([
      { personId: 'p3', reason: 'not_related' },
      { personId: 'p5', reason: 'condition_not_met' },
    ]);
    expect(unit.open).toBe(false);
  });

  it('is open when a relationship is not recorded in full', () => {
    const value = snapshot({ people: [{ id: 'p1', birthDate: '1980-01-01' }] });
    const open = computeUnit(value, entry(), 'p1', context());
    expect(open.open).toBe(true);
    expect(open.missingMarkers).toEqual([
      { personId: 'p1', marker: 'spouses' },
      { personId: 'p1', marker: 'children' },
      { personId: 'p1', marker: 'parents' },
    ]);
  });

  it('makes an undated adoption possible before recordedOn, naming the relationship', () => {
    const adoption = { kind: 'parent', parent: 'p1', child: 'p2', parentKind: 'adoptive' };
    const value = snapshot({
      members: ['p1', 'p2'],
      people: [known('p1', '1980-01-01'), known('p2', '2012-01-01')],
      relationships: [adoption],
    });
    const now = computeUnit(value, entry(), 'p1', context());
    expect(now.included.map((member) => member.personId)).toEqual(['p2']);
    const earlier = computeUnit(
      value,
      entry(),
      'p1',
      context({ factsAsOf: parseCalendarDate('2020-01-01') }),
    );
    expect(earlier.possible.map((member) => member.missingFacts)).toEqual([
      [{ kind: 'relationship', edge: adoption }],
    ]);
  });

  it('reads a rule at its reference date, and is open without it', () => {
    const atFiling = entry({
      referenceDates: ['filingDate'],
      dependents: [{ ...sampleVersion.dependents[1], at: 'filingDate' }],
    });
    const value = family();
    const missing = computeUnit(value, atFiling, 'p1', context());
    expect(missing.open).toBe(true);
    expect(missing.missingDates).toEqual(['filingDate']);
    const filed = computeUnit(
      value,
      atFiling,
      'p1',
      context({ referenceDates: new Map([['filingDate', parseCalendarDate('2018-01-01')]]) }),
    );
    // Aged 18 when filed, so the age protection keeps p5 in.
    expect(filed.included.map((member) => member.personId)).toEqual(['p4', 'p5']);
  });
});

describe('evaluateVersion', () => {
  it.each<[string, CaseSnapshot, object, string]>([
    ['eligible', alone(5000_00), {}, 'eligible'],
    ['not eligible when a requirement is false', alone(5000_00, '2015-01-01'), {}, 'not_eligible'],
    ['missing information when one is unknown', family(), {}, 'missing_information'],
    [
      'needs assessment when the requirements hold',
      alone(5000_00),
      {
        assessments: [
          {
            id: 'ties',
            title: 'Ties',
            evidence: ['principal.residenceCountry'],
            sources: ['law'],
          },
        ],
      },
      'needs_assessment',
    ],
    [
      'unavailable when the version is closed',
      alone(5000_00),
      {
        status: 'closed',
        closureSources: ['law'],
        requirements: [],
        dependents: [],
        costs: [],
      },
      'unavailable',
    ],
  ])('%s', (_label, value, patch, status) => {
    expect(evaluateVersion(value, entry(patch), 'p1', context()).status).toBe(status);
  });

  it('records the version, the dates and the engine commit', () => {
    const evaluation = evaluateVersion(alone(5000_00), entry(), 'p1', context());
    expect(evaluation).toMatchObject({
      routeId: 'qm-sample',
      versionNumber: 1,
      hash: 'hash-1',
      engineCommit: 'test',
      rulesAsOf: '2026-11-03',
      factsAsOf: '2026-11-03',
      principalId: 'p1',
    });
    expect(evaluation.requirements.map((requirement) => requirement.result)).toEqual([true, true]);
    expect(evaluation.requirements[0]?.sources.map((source) => source.id)).toEqual(['law']);
    expect(evaluation.durations).toMatchObject([{ id: 'decision', min: 'P2M', max: 'P6M' }]);
  });

  it('lists the decisive missing facts, with the facts behind possible dependents', () => {
    const evaluation = evaluateVersion(family(), entry(), 'p1', context());
    expect(evaluation.missingFacts).toEqual(
      expect.arrayContaining([
        { kind: 'fact', reference: 'unit.liquidAssets', personId: 'p1' },
        { kind: 'marker', personId: 'p6', marker: 'assets' },
        { kind: 'fact', reference: 'person.ageYears', personId: 'p6' },
        { kind: 'fact', reference: 'person.dependsOnPrincipal', personId: 'p8' },
      ]),
    );
    expect(evaluation.missingFacts).not.toContainEqual(
      expect.objectContaining({ reference: 'principal.ageYears' }),
    );
  });

  it('lists no missing facts when a requirement is false', () => {
    const young = snapshot({
      people: [{ id: 'p1', birthDate: '2015-01-01' }],
      assets: [],
    });
    const evaluation = evaluateVersion(young, entry(), 'p1', context());
    expect(evaluation.status).toBe('not_eligible');
    expect(evaluation.missingFacts).toEqual([]);
  });

  it('skips facts that a known operand cuts off', () => {
    const cutOff = entry({
      requirements: [
        {
          id: 'either',
          title: 'Either',
          expression: {
            op: 'any',
            operands: [
              { op: 'fact', key: 'principal.studying' },
              {
                op: 'all',
                operands: [
                  { op: 'fact', key: 'principal.dependsOnPrincipal' },
                  { op: 'bool', value: false },
                ],
              },
            ],
          },
          sources: ['law'],
        },
      ],
    });
    const evaluation = evaluateVersion(alone(5000_00), cutOff, 'p1', context());
    expect(evaluation.missingFacts).toEqual([
      { kind: 'fact', reference: 'principal.studying', personId: 'p1' },
    ]);
  });

  it('reports missing rates and dates apart, and the rates it used', () => {
    const value = snapshot({
      people: [known('p1', '1980-01-01')],
      assets: [
        {
          ...(cash('p1', 1000_00) as Record<string, unknown>),
          value: { amount: 4000_00, currency: 'USD' },
        },
        {
          ...(cash('p2', 0) as Record<string, unknown>),
          id: 'a9',
          owners: [{ person: 'p1', share: '1' }],
          value: { amount: 1, currency: 'BRL' },
        },
      ],
    });
    const atFiling = entry({
      referenceDates: ['filingDate'],
      requirements: [
        ...sampleVersion.requirements,
        {
          id: 'young-at-filing',
          title: 'Under 60 when filing',
          expression: {
            op: 'lt',
            left: { op: 'fact', key: 'principal.ageYears', at: 'filingDate' },
            right: { op: 'int', value: 60 },
          },
          sources: ['law'],
        },
      ],
    });
    const evaluation = evaluateVersion(value, atFiling, 'p1', context());
    expect(evaluation.missingRates).toEqual([{ from: 'BRL', to: 'EUR' }]);
    expect(evaluation.missingDates).toEqual(['filingDate']);
    expect(evaluation.rates).toMatchObject([{ from: 'USD', to: 'EUR', rate: '0.5' }]);
    expect(evaluation.missingFacts).toEqual([]);
  });

  it('prices costs per payer, with a known total and the possible extra', () => {
    const evaluation = evaluateVersion(family(), entry(), 'p1', context());
    expect(
      evaluation.costs.map((cost) => [cost.costId, cost.personId, cost.applies, cost.amount]),
    ).toEqual([
      [
        'fee',
        'p1',
        true,
        { min: { amount: 100_00, currency: 'EUR' }, max: { amount: 100_00, currency: 'EUR' } },
      ],
      [
        'dependent-fee',
        'p2',
        true,
        { min: { amount: 50_00, currency: 'EUR' }, max: { amount: 50_00, currency: 'EUR' } },
      ],
      [
        'dependent-fee',
        'p4',
        true,
        { min: { amount: 50_00, currency: 'EUR' }, max: { amount: 50_00, currency: 'EUR' } },
      ],
      [
        'dependent-fee',
        'p7',
        true,
        { min: { amount: 50_00, currency: 'EUR' }, max: { amount: 50_00, currency: 'EUR' } },
      ],
      [
        'dependent-fee',
        'p6',
        'unknown',
        { min: { amount: 50_00, currency: 'EUR' }, max: { amount: 50_00, currency: 'EUR' } },
      ],
      [
        'dependent-fee',
        'p8',
        'unknown',
        { min: { amount: 50_00, currency: 'EUR' }, max: { amount: 50_00, currency: 'EUR' } },
      ],
    ]);
    expect(evaluation.totals).toEqual([
      {
        currency: 'EUR',
        certain: {
          min: { amount: 250_00, currency: 'EUR' },
          max: { amount: 250_00, currency: 'EUR' },
        },
        possibleExtra: {
          min: { amount: 0, currency: 'EUR' },
          max: { amount: 100_00, currency: 'EUR' },
        },
      },
    ]);
  });

  it('leaves the extra unbounded when unrecorded people may owe a per-dependent cost', () => {
    const value = snapshot({ people: [{ id: 'p1', birthDate: '1980-01-01' }] });
    const [total] = evaluateVersion(value, entry(), 'p1', context()).totals;
    expect(total?.possibleExtra).toEqual({ min: { amount: 0, currency: 'EUR' } });
  });

  it('rounds each item, and each total from the exact sum', () => {
    const third = entry({
      costs: [
        {
          id: 'share',
          title: 'A third',
          kind: 'fee',
          amount: {
            op: 'mul',
            operand: { op: 'money', amount: 100, currency: 'EUR' },
            by: '0.335',
          },
          appliesTo: 'each_dependent',
          sources: ['law'],
        },
      ],
    });
    const evaluation = evaluateVersion(family(), third, 'p1', context());
    expect(evaluation.costs[0]?.amount.min).toEqual({ amount: 34, currency: 'EUR' });
    // Three certain items of 33.5 minor units: 100.5 rounds to 100, not 3 × 34.
    expect(evaluation.totals[0]?.certain.min).toEqual({ amount: 100, currency: 'EUR' });
  });

  it('shows assessment evidence present and missing', () => {
    const withTies = entry({
      assessments: [
        {
          id: 'ties',
          title: 'Ties',
          evidence: ['principal.residenceCountry', 'principal.educationLevel'],
          sources: ['law'],
        },
      ],
    });
    const value = snapshot({
      people: [known('p1', '1980-01-01', { residenceCountry: 'QN' })],
      assets: [cash('p1', 5000_00)],
    });
    const [ties] = evaluateVersion(value, withTies, 'p1', context()).assessments;
    expect(ties?.present).toEqual([
      { reference: 'principal.residenceCountry', value: { type: 'token', value: 'QN' } },
    ]);
    expect(ties?.missing).toEqual(['principal.educationLevel']);
  });

  it.each<[string, () => unknown]>([
    [
      'a factsAsOf after recordedOn',
      () =>
        evaluateVersion(
          alone(1),
          entry(),
          'p1',
          context({ factsAsOf: parseCalendarDate('2026-11-04') }),
        ),
    ],
    [
      'a reference date after recordedOn',
      () =>
        evaluateVersion(
          alone(1),
          entry(),
          'p1',
          context({ referenceDates: new Map([['filingDate', parseCalendarDate('2027-01-01')]]) }),
        ),
    ],
    ['a principal who is not a member', () => evaluateVersion(family(), entry(), 'p7', context())],
    [
      'an entry without its pinned set',
      () => evaluateVersion(alone(1), { ...entry(), countrySets: [] }, 'p1', context()),
    ],
  ])('refuses %s', (_label, run) => {
    expect(run).toThrow(RangeError);
  });

  it('stays linear in expressions times people on a 12-person snapshot', () => {
    const parents = ['p2', 'p3', 'p4', 'p5'];
    const children = ['p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12'];
    const value = snapshot({
      members: ['p1', ...parents, ...children],
      people: [
        known('p1', '1980-01-01'),
        ...parents.map((id, index) => known(id, `${String(1950 + index)}-01-01`)),
        ...children.map((id, index) => known(id, `${String(2000 + index * 3)}-01-01`)),
      ],
      relationships: [
        ...parents.map((parent) => ({ kind: 'parent', parent, child: 'p1' })),
        ...children.map((child) => ({ kind: 'parent', parent: 'p1', child })),
      ],
      assets: [cash('p1', 5000_00)],
    });
    const version = entry();
    const evaluation = evaluateVersion(value, version, 'p1', context());
    const traces = [
      ...evaluation.unit.traces,
      ...evaluation.requirements.map((requirement) => requirement.trace),
    ];
    const expressions = [
      ...version.version.requirements.map((requirement) => requirement.expression),
      ...version.version.dependents.map((rule) => rule.condition),
    ];
    const bound = expressions.reduce((total, each) => total + nodeCount(each), 0) * 12;
    expect(traces.reduce((total, trace) => total + traceSize(trace), 0)).toBeLessThanOrEqual(bound);
  });
});

function traceSize(trace: Trace): number {
  return 1 + trace.children.reduce((total, child) => total + traceSize(child), 0);
}

describe('evaluateRoute', () => {
  const v1 = entry();
  const v2 = entry({ number: 2, effectiveFrom: '2027-01-01' });
  const catalog = (entries = [v1, v2]): RouteCatalog => ({
    identities: () => entries.map((each) => each.identity),
    activeEntry: vi.fn((identity: VersionIdentity, states: DecisionStates) =>
      states.get(identityKey(identity)) === 'active'
        ? entries.find((each) => each.identity.number === identity.number)
        : undefined,
    ),
  });

  it('evaluates the active version in effect and names a newer one awaiting activation', () => {
    const result = evaluateRoute(alone(5000_00), catalog(), 'qm-sample', 'p1', context());
    expect(result.kind).toBe('evaluated');
    if (result.kind !== 'evaluated') return;
    expect(result.status).toBe('eligible');
    expect(result.evaluation.versionNumber).toBe(1);
    expect(result.newerProposedVersion).toEqual({ identity: v2.identity, from: '2027-01-01' });
  });

  it('reports a version in effect but not active as pending, and never reads its content', () => {
    const lookup = catalog();
    const result = evaluateRoute(
      alone(5000_00),
      lookup,
      'qm-sample',
      'p1',
      context({
        rulesAsOf: parseCalendarDate('2027-02-01'),
        factsAsOf: parseCalendarDate('2026-11-03'),
      }),
    );
    expect(result).toEqual({
      kind: 'pending',
      status: 'pending_activation',
      routeId: 'qm-sample',
      pending: v2.identity,
    });
    expect(lookup.activeEntry).not.toHaveBeenCalled();
  });

  it('is unavailable when no version is in effect', () => {
    const result = evaluateRoute(
      alone(5000_00),
      catalog(),
      'qm-sample',
      'p1',
      context({
        rulesAsOf: parseCalendarDate('2019-01-01'),
        factsAsOf: parseCalendarDate('2019-01-01'),
      }),
    );
    expect(result).toEqual({ kind: 'no_version', status: 'unavailable', routeId: 'qm-sample' });
  });
});
