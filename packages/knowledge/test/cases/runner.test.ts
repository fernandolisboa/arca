import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildKnowledge } from '../../scripts/build.ts';
import { parseEntries } from '../../src/entries.ts';
import { createReproductionLookup } from '../../src/reproduction.ts';
import { baseTree, buildDate, fixtures, routeVersion, writeTree } from '../data.ts';
import { type CasesRun, runCases } from './runner.ts';

/** Synthetic only: a treaty citizen of a user-assigned country. */
const citizen = {
  recordedOn: '2026-10-01',
  members: ['p1'],
  people: [
    {
      id: 'p1',
      birthDate: '1990-01-01',
      citizenships: [{ country: 'QN', acquired: '1990-01-01', lost: 'none' }],
    },
  ],
  relationships: [],
  assets: [],
};

const eligible = {
  id: 'treaty-citizen',
  snapshot: citizen,
  principal: 'p1',
  rulesAsOf: '2026-10-01',
  expected: { status: 'eligible', dependents: [], possibleDependents: [], missingFacts: [] },
};

/** Children under 18. */
const children = {
  id: 'children',
  title: 'Children under 18',
  path: ['child'],
  condition: {
    op: 'lt',
    left: { op: 'fact', key: 'person.ageYears' },
    right: { op: 'int', value: 18 },
  },
  sources: ['law'],
};

async function run(tree: Record<string, unknown>, families?: string): Promise<CasesRun> {
  const familiesDir = families ?? (await mkdtemp(join(tmpdir(), 'arca-families-')));
  const dir = await writeTree(tree);
  const { entries, issues } = await buildKnowledge(dir, buildDate, fixtures);
  expect(issues).toEqual([]);
  return runCases(dir, familiesDir, createReproductionLookup(parseEntries(entries)));
}

const withCases = (cases: object[]): Record<string, unknown> => ({
  ...baseTree(),
  'routes/qm-work/1.cases.json': { schemaVersion: 1, cases },
});

describe('runCases', () => {
  it('requires a cases file for every route version', async () => {
    expect((await run(baseTree())).problems).toEqual([
      'routes/qm-work/1.json: A route version has a cases file',
    ]);
  });

  it('reports a result that differs from the expected one, and the coverage gaps', async () => {
    const wrong = { ...eligible, expected: { ...eligible.expected, status: 'not_eligible' } };
    expect((await run(withCases([wrong]))).problems).toEqual([
      'routes/qm-work/1.cases.json treaty-citizen: status is "eligible", expected "not_eligible"',
      'routes/qm-work/1.cases.json: No case is not_eligible',
      'routes/qm-work/1.cases.json: No case is missing_information',
      'routes/qm-work/1.cases.json: Requirement treaty-citizen is never false',
      'routes/qm-work/1.cases.json: Requirement treaty-citizen is never unknown',
    ]);
  });

  it('runs only the newest of a superseded case, and refuses duplicate IDs', async () => {
    const old = {
      ...eligible,
      id: 'old',
      expected: { ...eligible.expected, status: 'unavailable' },
    };
    const newer = { ...eligible, id: 'newer', supersedes: 'old', reason: 'The engine changed' };
    const { problems, cases } = await run(withCases([old, newer, newer]));
    expect(cases).toBe(2);
    expect(problems).toContain('routes/qm-work/1.cases.json: Case IDs are unique');
    expect(problems.some((problem) => problem.includes(' old: '))).toBe(false);
  });

  it('refuses a supersede of itself, of a missing case, twice, or in a cycle', async () => {
    const superseding = (id: string, supersedes: string) => ({
      ...eligible,
      id,
      supersedes,
      reason: 'The engine changed',
    });
    const { problems } = await run(
      withCases([
        eligible,
        superseding('self', 'self'),
        superseding('ghost', 'missing'),
        superseding('first', 'treaty-citizen'),
        superseding('second', 'treaty-citizen'),
        superseding('ping', 'pong'),
        superseding('pong', 'ping'),
      ]),
    );
    expect(problems.filter((problem) => !problem.includes('Requirement'))).toEqual([
      'routes/qm-work/1.cases.json: A case is superseded at most once',
      'routes/qm-work/1.cases.json self: Its chain of supersedes forms a cycle',
      'routes/qm-work/1.cases.json ghost: The case it supersedes is in the file',
      'routes/qm-work/1.cases.json ping: Its chain of supersedes forms a cycle',
      'routes/qm-work/1.cases.json pong: Its chain of supersedes forms a cycle',
      'routes/qm-work/1.cases.json: No case is not_eligible',
      'routes/qm-work/1.cases.json: No case is missing_information',
    ]);
  });

  it('reports a cases file it cannot parse, and still runs the other files', async () => {
    const { problems, cases } = await run({
      ...baseTree(),
      'routes/qm-work/1.cases.json': '{',
      'routes/qm-other/1.json': routeVersion({ routeId: 'qm-other' }),
      'routes/qm-other/1.cases.json': { schemaVersion: 1, cases: [eligible] },
    });
    expect(cases).toBe(1);
    expect(problems.at(-1)).toMatch(/^routes\/qm-work\/1\.cases\.json: /);
    expect(problems.slice(0, -1)).toEqual([
      'routes/qm-other/1.cases.json: No case is not_eligible',
      'routes/qm-other/1.cases.json: No case is missing_information',
      'routes/qm-other/1.cases.json: Requirement treaty-citizen is never false',
      'routes/qm-other/1.cases.json: Requirement treaty-citizen is never unknown',
    ]);
  });

  it('measures each dependent rule alone, so a possible dependent includes no one', async () => {
    const family = {
      ...citizen,
      members: ['p1', 'p2', 'p3'],
      people: [
        { ...citizen.people[0], recordedInFull: ['children'] },
        { id: 'p2' },
        { id: 'p3', birthDate: '1990-01-01' },
      ],
      relationships: [
        { kind: 'parent', parent: 'p1', child: 'p2', parentKind: 'biological' },
        { kind: 'parent', parent: 'p1', child: 'p3', parentKind: 'biological' },
      ],
    };
    const { problems } = await run({
      ...baseTree(),
      'routes/qm-work/1.json': routeVersion({
        dependents: [children],
        leapDayBirthday: 'feb-28',
        leapDayBirthdaySources: ['law'],
      }),
      'routes/qm-work/1.cases.json': {
        schemaVersion: 1,
        cases: [
          {
            ...eligible,
            snapshot: family,
            expected: { ...eligible.expected, possibleDependents: ['p2'] },
          },
        ],
      },
    });
    expect(problems).toContain(
      'routes/qm-work/1.cases.json: Dependent rule children never includes anyone',
    );
    expect(problems.some((problem) => problem.includes('never excludes'))).toBe(false);
  });

  it('does not ask an unconditional rule to exclude anyone, but still to include someone', async () => {
    const spouse = {
      id: 'spouse',
      title: 'Spouse',
      path: ['spouse'],
      condition: { op: 'bool', value: true },
      sources: ['law'],
    };
    const family = {
      ...citizen,
      members: ['p1', 'p2'],
      people: [{ ...citizen.people[0], recordedInFull: ['spouses'] }, { id: 'p2' }],
      relationships: [{ kind: 'spouse', people: ['p1', 'p2'], start: '2010-01-01', end: 'none' }],
    };
    const tree = (cases: readonly object[]): Record<string, unknown> => ({
      ...baseTree(),
      'routes/qm-work/1.json': routeVersion({ dependents: [spouse] }),
      'routes/qm-work/1.cases.json': { schemaVersion: 1, cases },
    });
    const covered = await run(
      tree([
        { ...eligible, snapshot: family, expected: { ...eligible.expected, dependents: ['p2'] } },
      ]),
    );
    expect(covered.problems.some((problem) => problem.includes('Dependent rule'))).toBe(false);
    const uncovered = await run(tree([eligible]));
    expect(uncovered.problems).toContain(
      'routes/qm-work/1.cases.json: Dependent rule spouse never includes anyone',
    );
  });

  it('does not ask a rule that cannot be false to exclude anyone, unlike one that can', async () => {
    const partner = (condition: object) => ({
      id: 'partner',
      title: 'Partner',
      path: ['partner'],
      condition,
      sources: ['law'],
    });
    const sinceAYear = { op: 'since', date: { op: 'fact', key: 'edge.start' }, duration: 'P1Y' };
    const family = {
      ...citizen,
      members: ['p1', 'p2'],
      people: [{ ...citizen.people[0], recordedInFull: ['partners'] }, { id: 'p2' }],
      relationships: [{ kind: 'partner', people: ['p1', 'p2'], start: '2010-01-01', end: 'none' }],
    };
    const tree = (condition: object): Record<string, unknown> => ({
      ...baseTree(),
      'routes/qm-work/1.json': routeVersion({ dependents: [partner(condition)] }),
      'routes/qm-work/1.cases.json': {
        schemaVersion: 1,
        cases: [
          { ...eligible, snapshot: family, expected: { ...eligible.expected, dependents: ['p2'] } },
        ],
      },
    });
    const orUnmodeled = await run(tree({ op: 'any', operands: [sinceAYear, { op: 'unmodeled' }] }));
    expect(orUnmodeled.problems.some((problem) => problem.includes('Dependent rule'))).toBe(false);
    const decidable = await run(tree(sinceAYear));
    expect(decidable.problems).toContain(
      'routes/qm-work/1.cases.json: Dependent rule partner never excludes anyone',
    );
  });

  it('does not count a rule as including someone another rule included', async () => {
    const students = {
      id: 'students',
      title: 'Children who study',
      path: ['child'],
      condition: { op: 'fact', key: 'person.studying' },
      sources: ['law'],
    };
    const family = {
      ...citizen,
      members: ['p1', 'p2', 'p3'],
      people: [
        { ...citizen.people[0], recordedInFull: ['children'] },
        { id: 'p2', birthDate: '2015-01-01' },
        { id: 'p3', birthDate: '1990-01-01', studying: false },
      ],
      relationships: [
        { kind: 'parent', parent: 'p1', child: 'p2', parentKind: 'biological' },
        { kind: 'parent', parent: 'p1', child: 'p3', parentKind: 'biological' },
      ],
    };
    const { problems } = await run({
      ...baseTree(),
      'routes/qm-work/1.json': routeVersion({
        dependents: [children, students],
        leapDayBirthday: 'feb-28',
        leapDayBirthdaySources: ['law'],
      }),
      'routes/qm-work/1.cases.json': {
        schemaVersion: 1,
        cases: [
          {
            ...eligible,
            snapshot: family,
            expected: { ...eligible.expected, dependents: ['p2'] },
          },
        ],
      },
    });
    expect(problems).toContain(
      'routes/qm-work/1.cases.json: Dependent rule students never includes anyone',
    );
    expect(problems.some((problem) => problem.includes('children never'))).toBe(false);
  });

  it('refuses a family whose bytes do not match the pinned hash', async () => {
    const familiesDir = await mkdtemp(join(tmpdir(), 'arca-families-'));
    await mkdir(join(familiesDir, 'citizen'));
    await writeFile(join(familiesDir, 'citizen', '1.json'), JSON.stringify(citizen));
    const pinned = {
      ...eligible,
      snapshot: undefined,
      family: { id: 'citizen', number: 1, sha256: 'a'.repeat(64) },
    };
    const { problems, cases } = await run(
      withCases([pinned, { ...eligible, id: 'after-the-broken-case' }]),
      familiesDir,
    );
    expect(problems).toContain(
      'routes/qm-work/1.cases.json treaty-citizen: Family citizen 1 does not hash to the pinned SHA-256',
    );
    expect(cases).toBe(1);
  });
});
