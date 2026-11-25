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
const reviewId = '2026-11-us-employer';

const consular = ['visa-application', 'passport', 'police-certificate', 'medical-examination'];
const adjustment = [
  'adjustment-application',
  'adjustment-medical-examination',
  'job-offer-confirmation',
];

const applies = (ids: readonly string[], value: boolean | 'unknown') =>
  Object.fromEntries(ids.map((id) => [id, value]));

/**
 * Where the principal lives picks the path: from abroad the consular papers apply and the Form I-485
 * papers do not; inside the U.S. either path may apply, since no fact says which one the family takes.
 */
describe.each(['us-eb3', 'us-eb2-job-offer'])(
  '%s v1 documents by where the principal lives (spec #519)',
  (routeId) => {
    it.each([
      ['blended-family-abroad', { ...applies(consular, true), ...applies(adjustment, false) }],
      [
        'blended-family-living-in-the-us',
        { ...applies(consular, 'unknown'), ...applies(adjustment, 'unknown') },
      ],
    ])(
      '%s',
      async (caseId, expected) => {
        const review = sessionReviews.find(({ id }) => id === reviewId);
        if (review === undefined) throw new Error(`No review ${reviewId}`);
        const version = (await reviewedVersions(dirs, review)).find(
          (found) => found.routeId === routeId,
        );
        if (version === undefined) throw new Error(`No ${routeId} v1`);
        const cases = JSON.parse(
          await readFile(join(dirs.reviewsDir, reviewId, `${routeId}.1.cases.json`), 'utf8'),
        ) as { cases: { id: string; snapshot: unknown }[] };
        const snapshot = caseSnapshotSchema.parse(
          cases.cases.find(({ id }) => id === caseId)?.snapshot,
        );
        const result = documentChecklist(snapshot, version.entry, 'p1', {
          rulesAsOf: parseCalendarDate('2026-12-01'),
          factsAsOf: parseCalendarDate('2026-10-01'),
          today: parseCalendarDate('2026-12-01'),
          fx: fxTableSchema.parse({ rates: [] }),
          engineCommit: 'test',
        });
        if (result.kind !== 'listed') throw new Error(result.kind);
        const byId = Object.fromEntries(
          result.principal.items.map(({ documentId, applies: value }) => [documentId, value]),
        );
        expect(Object.fromEntries(Object.keys(expected).map((id) => [id, byId[id]]))).toEqual(
          expected,
        );
      },
      120_000,
    );
  },
);
