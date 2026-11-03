import {
  type CaseSnapshot,
  type CatalogEntry,
  type Trace,
  caseSnapshotSchema,
  evaluateVersion,
  evaluateVersionTraced,
  fxTableSchema,
  nodeCount,
  parseCalendarDate,
} from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { fixtureEntries } from './data.ts';

const entries = [...(await fixtureEntries()).values()];
const date = parseCalendarDate('2026-11-03');

/**
 * Synthetic only: a principal, a spouse, four parents and step-parents, and `count` children born
 * three years apart from 2000, so some are adults and some minors.
 */
function family(count: number): CaseSnapshot {
  const parents = ['p2', 'p3', 'p4', 'p5'];
  const children = Array.from({ length: count }, (_, index) => `p${String(index + 7)}`);
  const person = (id: string, birthDate: string): object => ({
    id,
    birthDate,
    citizenships: [{ country: 'BR', acquired: birthDate, lost: 'none' }],
    residenceCountry: 'BR',
  });
  return caseSnapshotSchema.parse({
    recordedOn: '2026-11-03',
    members: ['p1', 'p6', ...parents, ...children],
    people: [
      person('p1', '1980-01-01'),
      person('p6', '1982-01-01'),
      ...parents.map((id, index) => person(id, `${String(1950 + index)}-01-01`)),
      ...children.map((id, index) => person(id, `${String(2000 + index * 3)}-01-01`)),
    ],
    relationships: [
      { kind: 'spouse', people: ['p1', 'p6'], start: '2000-01-01', end: 'none' },
      ...parents.map((parent) => ({ kind: 'parent', parent, child: 'p1' })),
      ...children.map((child) => ({ kind: 'parent', parent: 'p1', child })),
    ],
    assets: [],
  });
}

function context(entry: CatalogEntry) {
  return {
    rulesAsOf: date,
    today: date,
    referenceDates: new Map(
      (entry.version.referenceDates ?? []).map((name) => [name, parseCalendarDate('2026-09-01')]),
    ),
    fx: fxTableSchema.parse({ rates: [] }),
    engineCommit: 'performance',
  };
}

function traceSize(trace: Trace): number {
  return 1 + trace.children.reduce((total, child) => total + traceSize(child), 0);
}

const sizeOf = (snapshot: CaseSnapshot, entry: CatalogEntry): number =>
  evaluateVersionTraced(snapshot, entry, 'p1', context(entry)).traces.reduce(
    (total, trace) => total + traceSize(trace),
    0,
  );

/** Every expression the engine evaluates per person or edge, and each assessment's evidence. */
function expressionNodes({ version }: CatalogEntry): number {
  const expressions = [
    ...version.requirements.map((requirement) => requirement.expression),
    ...version.dependents.map((rule) => rule.condition),
    ...version.costs.flatMap((cost) => [cost.amount, ...(cost.condition ? [cost.condition] : [])]),
  ];
  const evidence = version.assessments.reduce((total, each) => total + each.evidence.length, 0);
  return expressions.reduce((total, each) => total + nodeCount(each), evidence);
}

const named = entries.map(
  (entry) => [`${entry.identity.routeId} ${String(entry.identity.number)}`, entry] as const,
);

describe('engine performance (spec 0002, R5)', () => {
  it.each(named)('bounds the traces by expressions times people and edges: %s', (_, entry) => {
    const twelve = family(6);
    const scale = twelve.people.length + twelve.relationships.length;
    expect(sizeOf(twelve, entry)).toBeLessThanOrEqual(expressionNodes(entry) * scale);
  });

  it.each(named)('grows at most linearly with the family: %s', (_, entry) => {
    // Linear growth a + b·n at most doubles when n doubles; anything faster does more.
    expect(sizeOf(family(12), entry)).toBeLessThanOrEqual(2 * sizeOf(family(6), entry));
  });
});

describe('fixture costs', () => {
  it('prices the fee once and the residence card for each adult dependent', () => {
    const entry = entries.find((each) => each.identity.routeId === 'qm-passive-income');
    if (entry === undefined) throw new Error('The passive-income fixture route is missing');
    const { costs, totals } = evaluateVersion(family(6), entry, 'p1', context(entry));
    expect(
      costs.map(({ costId, personId, applies, amount }) => ({ costId, personId, applies, amount })),
    ).toEqual([
      { costId: 'application-fee', personId: 'p1', applies: true, amount: euros(90_00) },
      { costId: 'residence-card', personId: 'p6', applies: true, amount: euros(70_00) },
      ...['p10', 'p11', 'p12'].map((personId) => ({
        costId: 'residence-card',
        personId,
        applies: false,
        amount: euros(70_00),
      })),
    ]);
    // The family is not recorded in full, so unrecorded dependents may owe a card: no upper bound.
    expect(totals).toEqual([
      { currency: 'EUR', certain: euros(160_00), possibleExtra: { min: euros(0).min } },
    ]);
  });
});

function euros(amount: number) {
  const money = { amount, currency: 'EUR' };
  return { min: money, max: money };
}
