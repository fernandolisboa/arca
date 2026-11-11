import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseSnapshotSchema, maxKnowledgeJsonDepth } from '@arca/domain';
import { parseJsonSubset } from '@arca/scripts/json';
import { describe, expect, it } from 'vitest';
import { readKnowledgeFile } from '../../scripts/load.ts';
import { createReproductionLookup, reproductionEntry } from '../../src/reproduction.ts';
import { fixtureEntries, fixturesDir } from '../data.ts';
import { runCases } from './runner.ts';

const packageDir = fileURLToPath(new URL('../..', import.meta.url));
const familiesDir = join(packageDir, '..', '..', 'eval', 'families');

describe('table-driven cases', () => {
  // Every route version adds cases, and a full `pnpm check` shares the machine with other tasks.
  it('pass for every version in the knowledge base, with coverage', async () => {
    const run = await runCases(join(packageDir, 'data'), familiesDir, reproductionEntry);
    expect(run.problems).toEqual([]);
  }, 60_000);

  it('pass for every fixture route, with coverage', async () => {
    const lookup = createReproductionLookup(await fixtureEntries());
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
