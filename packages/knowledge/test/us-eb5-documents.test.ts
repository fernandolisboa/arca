import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CaseSnapshot,
  type DocumentResult,
  caseSnapshotSchema,
  documentChecklist,
  fxTableSchema,
  parseCalendarDate,
} from '@arca/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type ReviewDirs,
  type ReviewedVersion,
  reviewedVersions,
  sessionReviews,
} from '../scripts/session-review.ts';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const dirs: ReviewDirs = {
  dataDir: join(packageDir, 'data'),
  familiesDir: join(packageDir, '..', '..', 'eval', 'families'),
  reviewsDir: join(packageDir, 'reviews'),
};
const reviewId = '2026-11-us-documents';

/**
 * Who hands in which us-eb5 v10 document, on the synthetic blended family of the version's own
 * cases: a spouse (p2), a biological child (p3), an adopted child (p5), a stepchild (p7) and a
 * possible adopted child (p6). Items with no condition apply; the consular ones may apply, since no
 * fact says the visa is issued abroad; relationship records follow the dependent's edge, and a
 * possible dependent's items only may apply.
 */
describe('us-eb5 v10 documents on a synthetic family (spec #519)', () => {
  let version: ReviewedVersion;
  let snapshot: CaseSnapshot;

  beforeAll(async () => {
    const review = sessionReviews.find(({ id }) => id === reviewId);
    if (review === undefined) throw new Error(`No review ${reviewId}`);
    const found = (await reviewedVersions(dirs, review)).find(
      ({ routeId, number }) => routeId === 'us-eb5' && number === 10,
    );
    if (found === undefined) throw new Error('No us-eb5 v10');
    version = found;
    const cases = JSON.parse(
      await readFile(join(dirs.reviewsDir, reviewId, 'us-eb5.10.cases.json'), 'utf8'),
    ) as { cases: { id: string; snapshot: unknown }[] };
    const blended = cases.cases.find(({ id }) => id === 'blended-family-capital-covered');
    snapshot = caseSnapshotSchema.parse(blended?.snapshot);
  }, 120_000);

  const checklist = () =>
    documentChecklist(snapshot, version.entry, 'p1', {
      rulesAsOf: parseCalendarDate('2026-12-01'),
      factsAsOf: parseCalendarDate('2026-10-01'),
      today: parseCalendarDate('2026-12-01'),
      fx: fxTableSchema.parse({ rates: [] }),
      engineCommit: 'test',
    });

  const listed = () => {
    const result = checklist();
    if (result.kind !== 'listed') throw new Error(result.kind);
    return result;
  };

  const truths = (items: readonly DocumentResult[]) =>
    Object.fromEntries(items.map(({ documentId, applies }) => [documentId, applies]));

  const consular = (suffix: string) =>
    Object.fromEntries(
      [
        'visa-application',
        'passport',
        'birth-certificate',
        'police-certificate',
        'prison-record',
        'military-record',
        'photographs',
        'medical-examination',
      ].map((id) => [`${id}${suffix}`, 'unknown']),
    );

  it("lists the investor's petition evidence and visa papers", () => {
    const result = listed();
    expect(truths(result.principal.items)).toEqual({
      'investor-petition': true,
      'regional-center-records': 'unknown',
      'fee-disclosure': true,
      'enterprise-documents': true,
      'capital-at-risk': true,
      'source-of-funds': true,
      'business-registration': 'unknown',
      'tax-returns': 'unknown',
      'judgment-records': 'unknown',
      'fund-transferors': 'unknown',
      'gift-or-loan-records': 'unknown',
      engagement: true,
      ...consular(''),
      'marriage-record': 'unknown',
      'vaccination-record': true,
    });
    expect(result.unit).toEqual([]);
  });

  it.each([
    ['p2', 'the spouse', { 'marriage-record-dependent': 'unknown', 'adoption-records': false }],
    ['p3', 'a biological child', { 'marriage-record-dependent': false, 'adoption-records': false }],
    [
      'p5',
      'an adopted child',
      { 'marriage-record-dependent': false, 'adoption-records': 'unknown' },
    ],
    ['p7', 'a stepchild', { 'marriage-record-dependent': false, 'adoption-records': false }],
    [
      'p6',
      'a possible adopted child',
      { 'marriage-record-dependent': false, 'adoption-records': 'unknown' },
    ],
  ])('lists %s (%s) their own papers', (personId, _who, relationship) => {
    const result = listed();
    const person = result.dependents.find((each) => each.personId === personId);
    expect(person?.possible).toBe(personId === 'p6');
    expect(truths(person?.items ?? [])).toEqual({
      ...consular('-dependent'),
      ...relationship,
      'vaccination-record-dependent': personId === 'p6' ? 'unknown' : true,
    });
  });
});
