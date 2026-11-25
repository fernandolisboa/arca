import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  caseSnapshotSchema,
  documentChecklist,
  fxTableSchema,
  parseCalendarDate,
} from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { type ReviewDirs, reviewedVersions, sessionReviews } from '../scripts/session-review.ts';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const dirs: ReviewDirs = {
  dataDir: join(packageDir, 'data'),
  familiesDir: join(packageDir, '..', '..', 'eval', 'families'),
  reviewsDir: join(packageDir, 'reviews'),
};
const reviewId = '2026-11-cl-documents';
const routeId = 'cl-mercosur-temporary';

type Applies = boolean | 'unknown';

async function checklist(caseId: string): Promise<Record<string, Record<string, Applies>>> {
  const review = sessionReviews.find(({ id }) => id === reviewId);
  if (review === undefined) throw new Error(`No review ${reviewId}`);
  const version = (await reviewedVersions(dirs, review)).find((found) => found.routeId === routeId);
  if (version === undefined) throw new Error(`No ${routeId} v6`);
  const cases = JSON.parse(
    await readFile(join(dirs.reviewsDir, reviewId, `${routeId}.6.cases.json`), 'utf8'),
  ) as { cases: { id: string; snapshot: unknown }[] };
  const snapshot = caseSnapshotSchema.parse(cases.cases.find(({ id }) => id === caseId)?.snapshot);
  const result = documentChecklist(snapshot, version.entry, 'p1', {
    rulesAsOf: parseCalendarDate('2026-10-01'),
    factsAsOf: parseCalendarDate('2026-10-01'),
    today: parseCalendarDate('2026-10-01'),
    fx: fxTableSchema.parse({ rates: [] }),
    engineCommit: 'test',
  });
  if (result.kind !== 'listed') throw new Error(result.kind);
  return Object.fromEntries(
    [result.principal, ...result.dependents].map(({ personId, items }) => [
      personId,
      Object.fromEntries(items.map(({ documentId, applies }) => [documentId, applies])),
    ]),
  );
}

const dependentIds = [
  'police-certificate-dependent',
  'marriage-certificate-dependent',
  'cohabitation-proof-dependent',
  'birth-certificate-dependent',
  'care-statement-dependent',
  'support-statement-dependent',
  'means-proof-dependent',
  'stepchild-union-proof-dependent',
  'disability-certificate-dependent',
  'enrollment-certificate-dependent',
] as const;

const row = (...values: Applies[]) =>
  Object.fromEntries(dependentIds.map((id, index) => [id, values[index]]));

/**
 * The dependents' papers by tie (SERMIG's dependents page): a spouse or partner hands in the
 * couple's proof, a child the birth certificate; a minor the care statement; the statement of costs
 * and means proof go with an adult dependent and are possible for a minor, whose disability is not
 * recorded; the enrollment certificate stops at 24.
 */
describe('cl-mercosur-temporary v6 documents by tie and age (spec #519)', () => {
  it('a spouse, two minor children and an adult child of 36', async () => {
    const lists = await checklist('brazilian-with-spouse-children-stepchild-and-parent');
    expect(lists['p1']).toMatchObject({
      passport: true,
      photograph: true,
      'police-certificate': true,
    });
    const pick = (person: string) =>
      Object.fromEntries(dependentIds.map((id) => [id, lists[person]?.[id]]));
    expect(pick('p2')).toEqual(
      row(true, true, false, false, false, true, true, false, false, false),
    );
    expect(pick('p3')).toEqual(
      row(false, false, false, true, true, 'unknown', 'unknown', 'unknown', 'unknown', false),
    );
    expect(pick('p5')).toEqual(pick('p3'));
    // An adult child is only a possible dependent, so every paper that could apply reads unknown.
    expect(pick('p4')).toEqual(
      row(
        'unknown',
        false,
        false,
        'unknown',
        false,
        'unknown',
        'unknown',
        'unknown',
        'unknown',
        false,
      ),
    );
  }, 120_000);

  it('a partner hands in the cohabitation proof, not a marriage certificate', async () => {
    const lists = await checklist('brazilian-with-a-partner-and-the-partners-child');
    expect(lists['p2']).toMatchObject({
      'marriage-certificate-dependent': false,
      'cohabitation-proof-dependent': true,
      'birth-certificate-dependent': false,
    });
  }, 120_000);

  it('a principal under 18 hands in no criminal record certificate', async () => {
    const lists = await checklist('uruguayan-native-child');
    expect(lists['p1']).toMatchObject({ 'police-certificate': false, passport: true });
  }, 120_000);
});
