import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseSnapshotSchema, maxKnowledgeJsonDepth, parseCalendarDate } from '@arca/domain';
import { parseJsonSubset } from '@arca/scripts/json';
import { describe, expect, it } from 'vitest';
import { buildKnowledge, formatIssue } from '../../scripts/build.ts';
import { readKnowledgeFile } from '../../scripts/load.ts';
import { createReproductionLookup, reproductionEntry } from '../../src/reproduction.ts';
import { parseEntries } from '../../src/entries.ts';
import { runCases } from './runner.ts';

const packageDir = fileURLToPath(new URL('../..', import.meta.url));
const familiesDir = join(packageDir, '..', '..', 'eval', 'families');
const fixturesDir = join(packageDir, 'test', 'fixtures', 'data');

describe('table-driven cases', () => {
  it('pass for every version in the knowledge base, with coverage', async () => {
    const run = await runCases(join(packageDir, 'data'), familiesDir, reproductionEntry);
    expect(run.problems).toEqual([]);
  });

  it('pass for every fixture route, with coverage', async () => {
    const { entries, issues } = await buildKnowledge(fixturesDir, parseCalendarDate('2026-11-03'), {
      fixtures: true,
    });
    expect(issues.map(formatIssue)).toEqual([]);
    const lookup = createReproductionLookup(parseEntries(entries));
    const run = await runCases(fixturesDir, familiesDir, lookup);
    expect(run.problems).toEqual([]);
    expect(run.cases).toBeGreaterThan(0);
  });

  it('read synthetic families that are valid snapshots, numbered from 1', async () => {
    for (const id of await readdir(familiesDir)) {
      const names = (await readdir(join(familiesDir, id))).sort(
        (a, b) => parseInt(a) - parseInt(b),
      );
      expect(names, id).toEqual(names.map((_, index) => `${String(index + 1)}.json`));
      for (const name of names) {
        const bytes = await readKnowledgeFile(join(familiesDir, id, name));
        const parsed = caseSnapshotSchema.safeParse(parseJsonSubset(bytes, maxKnowledgeJsonDepth));
        expect(parsed.success, `${id}/${name}`).toBe(true);
      }
    }
  });
});
