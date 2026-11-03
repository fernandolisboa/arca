import { fileURLToPath } from 'node:url';
import {
  type CatalogEntry,
  type Trace,
  caseSnapshotSchema,
  evaluateVersionTraced,
  fxTableSchema,
  nodeCount,
  parseCalendarDate,
} from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { buildKnowledge, formatIssue } from '../scripts/build.ts';
import { parseEntries } from '../src/entries.ts';
import { buildDate, fixtures } from './data.ts';

const fixturesDir = fileURLToPath(new URL('fixtures/data', import.meta.url));
const { entries, issues } = await buildKnowledge(fixturesDir, buildDate, fixtures);

/** Synthetic only: a principal with four parents and step-parents and seven children. */
const parents = ['p2', 'p3', 'p4', 'p5'];
const children = ['p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12'];
const person = (id: string, birthDate: string): object => ({
  id,
  birthDate,
  citizenships: [{ country: 'BR', acquired: birthDate, lost: 'none' }],
  residenceCountry: 'BR',
});
const twelve = caseSnapshotSchema.parse({
  recordedOn: '2026-11-03',
  members: ['p1', ...parents, ...children],
  people: [
    person('p1', '1980-01-01'),
    ...parents.map((id, index) => person(id, `${String(1950 + index)}-01-01`)),
    ...children.map((id, index) => person(id, `${String(2000 + index * 3)}-01-01`)),
  ],
  relationships: [
    ...parents.map((parent) => ({ kind: 'parent', parent, child: 'p1' })),
    ...children.map((child) => ({ kind: 'parent', parent: 'p1', child })),
  ],
  assets: [],
});

function traceSize(trace: Trace): number {
  return 1 + trace.children.reduce((total, child) => total + traceSize(child), 0);
}

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

describe('engine performance (spec 0002, R5)', () => {
  it('builds the fixture catalog', () => {
    expect(issues.map(formatIssue)).toEqual([]);
  });

  it.each(
    [...parseEntries(entries).values()].map(
      (entry) => [`${entry.identity.routeId} ${String(entry.identity.number)}`, entry] as const,
    ),
  )('stays linear in expressions times people on a 12-person snapshot: %s', (_, entry) => {
    const date = parseCalendarDate('2026-11-03');
    const { traces } = evaluateVersionTraced(twelve, entry, 'p1', {
      rulesAsOf: date,
      today: date,
      referenceDates: new Map(
        (entry.version.referenceDates ?? []).map((name) => [name, parseCalendarDate('2026-09-01')]),
      ),
      fx: fxTableSchema.parse({ rates: [] }),
      engineCommit: 'performance',
    });
    // Items grow with people, and dependent conditions and costs with the edges people are reached by.
    const scale = twelve.people.length + twelve.relationships.length;
    const size = traces.reduce((total, trace) => total + traceSize(trace), 0);
    expect(size).toBeLessThanOrEqual(expressionNodes(entry) * scale);
  });
});
