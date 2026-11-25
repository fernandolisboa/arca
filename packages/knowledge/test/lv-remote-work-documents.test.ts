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
const reviewId = '2026-11-lv-remote-work';
const routeId = 'lv-remote-work';

const employee = ['employment-record', 'employer-confirmation'];
const selfEmployed = ['self-employment-registration', 'self-employment-statement'];

const applies = (ids: readonly string[], value: boolean | 'unknown') =>
  Object.fromEntries(ids.map((id) => [id, value]));

/**
 * The work period picks the remote work papers: an employee hands in the employer's, a self-employed
 * person or contractor their registration and statement; an owner may be either, so both read unknown.
 */
describe('lv-remote-work v1 documents by the kind of work (spec #519)', () => {
  it.each([
    [
      'employee-of-a-us-company-with-family',
      { ...applies(employee, true), ...applies(selfEmployed, false) },
    ],
    ['self-employed-is-possible', { ...applies(employee, false), ...applies(selfEmployed, true) }],
    ['owner-is-possible', { ...applies(employee, 'unknown'), ...applies(selfEmployed, 'unknown') }],
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
});
