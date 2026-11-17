import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeVersionSchema } from '@arca/domain';
import { hostOf } from '@arca/scripts/host';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildKnowledge } from '../scripts/build.ts';
import { inlineCasesMigrationFile, inlineCasesSql, inlinedRows } from '../scripts/inline-cases.ts';
import { importDate } from '../scripts/rule-import.ts';
import type { Json } from '../src/canonical.ts';
import { casesFileSchema } from '../src/cases.ts';
import { checkProposal } from '../src/proposal.ts';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const dataDir = join(packageDir, 'data');
const familiesDir = join(packageDir, '..', '..', 'eval', 'families');
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** A case without the family or snapshot it reads, which is all the rewrite may change. */
const withoutSnapshot = (ruleCase: object) =>
  Object.fromEntries(
    Object.entries(ruleCase).filter(([key]) => key !== 'family' && key !== 'snapshot'),
  );

async function setUp() {
  const { rows, countryFiles, issues } = await buildKnowledge(dataDir, importDate);
  expect(issues).toEqual([]);
  return { rows, countryFiles, inlined: await inlinedRows(rows, familiesDir) };
}

// Building the knowledge and running the cases is slow on a busy CI runner, so it happens once.
const buildTimeout = 120_000;
let built: Awaited<ReturnType<typeof setUp>>;
beforeAll(async () => {
  built = await setUp();
}, buildTimeout);

describe('inline imported cases (ADR-0031)', () => {
  it('is the committed migration, generated again', async () => {
    const { inlined } = built;
    const committed = await readFile(
      await inlineCasesMigrationFile(join(packageDir, '..', 'db', 'migrations')),
      'utf8',
    );
    expect(committed).toBe(inlineCasesSql(inlined));
  });

  it('rewrites exactly the versions whose cases pin a family, keeping every other field', () => {
    const { rows, inlined } = built;
    const pinning = rows.routeVersions.filter(
      (row) =>
        row.cases !== null &&
        casesFileSchema.parse(row.cases).cases.some((ruleCase) => ruleCase.family !== undefined),
    );
    expect(inlined.map(({ routeId, number }) => `${routeId}/${String(number)}`)).toEqual(
      pinning.map(({ routeId, number }) => `${routeId}/${String(number)}`),
    );
    expect(new Set(inlined.map(({ routeId }) => routeId))).toContain('us-eb5');
    for (const row of inlined) {
      const before = casesFileSchema.parse(row.imported).cases;
      const after = casesFileSchema.parse(row.inlined).cases;
      expect(after.every((ruleCase) => ruleCase.family === undefined)).toBe(true);
      expect(after.map(withoutSnapshot)).toEqual(before.map(withoutSnapshot));
    }
  });

  it(
    'lets the newest version of each rewritten route pass the proposal check for its next',
    async () => {
      const { rows, countryFiles, inlined } = built;
      const newest = new Map<string, (typeof inlined)[number]>();
      for (const row of inlined) {
        if ((newest.get(row.routeId)?.number ?? 0) < row.number) newest.set(row.routeId, row);
      }
      const reading = { countryFiles, sha256, hostOf };
      for (const row of newest.values()) {
        const stored = rows.routeVersions.find(
          (each) => each.routeId === row.routeId && each.number === row.number,
        );
        if (stored === undefined) throw new Error('The stored version expected');
        const base = routeVersionSchema.parse(stored.content);
        const later = new Date(`${base.effectiveFrom}T00:00:00Z`);
        later.setUTCDate(later.getUTCDate() + 1);
        const next = {
          ...Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'corrects')),
          number: base.number + 1,
          effectiveFrom: later.toISOString().slice(0, 10),
        } as unknown as Json;
        const withImported = await checkProposal(rows, base, next, row.imported, reading);
        expect(withImported.ok, row.routeId).toBe(false);
        const result = await checkProposal(rows, base, next, row.inlined, reading);
        expect(result.ok ? [] : result.problems, row.routeId).toEqual([]);
      }
    },
    buildTimeout,
  );
});
