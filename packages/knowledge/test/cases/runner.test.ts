import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildKnowledge } from '../../scripts/build.ts';
import { parseEntries } from '../../src/entries.ts';
import { createReproductionLookup } from '../../src/reproduction.ts';
import { baseTree, buildDate, fixtures, writeTree } from '../data.ts';
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

async function run(tree: Record<string, unknown>, familiesDir = tmpdir()): Promise<CasesRun> {
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

  it('refuses a family whose bytes do not match the pinned hash', async () => {
    const familiesDir = await mkdtemp(join(tmpdir(), 'arca-families-'));
    await mkdir(join(familiesDir, 'citizen'));
    await writeFile(join(familiesDir, 'citizen', '1.json'), JSON.stringify(citizen));
    const pinned = {
      ...eligible,
      snapshot: undefined,
      family: { id: 'citizen', number: 1, sha256: 'a'.repeat(64) },
    };
    expect((await run(withCases([pinned]), familiesDir)).problems).toContain(
      'routes/qm-work/1.cases.json treaty-citizen: Family citizen 1 does not hash to the pinned SHA-256',
    );
  });
});
