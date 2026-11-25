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
const reviewId = '2026-11-dk-documents';
const routeId = 'dk-pay-limit';

type Applies = boolean | 'unknown';

async function checklist(caseId: string): Promise<Record<string, Record<string, Applies>>> {
  const review = sessionReviews.find(({ id }) => id === reviewId);
  if (review === undefined) throw new Error(`No review ${reviewId}`);
  const version = (await reviewedVersions(dirs, review)).find((found) => found.routeId === routeId);
  if (version === undefined) throw new Error(`No ${routeId} v4`);
  const cases = JSON.parse(
    await readFile(join(dirs.reviewsDir, reviewId, `${routeId}.4.cases.json`), 'utf8'),
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
  'marriage-certificate-dependent',
  'cohabitation-proof-dependent',
  'birth-certificate-dependent',
  'custody-consent-dependent',
  'other-parent-id-dependent',
  'sole-custody-proof-dependent',
  'dependence-proof-dependent',
] as const;

const row = (...values: Applies[]) =>
  Object.fromEntries(dependentIds.map((id, index) => [id, values[index]]));

const pick = (lists: Record<string, Record<string, Applies>>, person: string) =>
  Object.fromEntries(dependentIds.map((id) => [id, lists[person]?.[id]]));

/**
 * The family members' papers by tie (SIRI's page on accompanying family of an employee): a
 * spouse hands in the marriage certificate, a partner the cohabitation proof, a child under 18 the
 * birth certificate, possible since the birthplace is not recorded; the other custody holder's consent and ID go with shared custody and may
 * apply, since whether that parent comes along is not recorded; the sole-custody proof goes with
 * full custody; other family of 18 or more documents their dependence.
 */
describe('dk-pay-limit v4 documents by tie, age and custody (spec #519)', () => {
  it('a spouse and a child under 18 whose custody is not recorded', async () => {
    const lists = await checklist('brazilian-family-with-spouse-and-children');
    expect(lists['p1']).toMatchObject({
      'fee-receipt': true,
      passport: true,
      'employment-contract': true,
      education: 'unknown',
    });
    expect(pick(lists, 'p2')).toEqual(row(true, false, false, false, false, false, false));
    expect(pick(lists, 'p3')).toEqual(
      row(false, false, 'unknown', 'unknown', 'unknown', 'unknown', false),
    );
  }, 120_000);

  it('shared custody asks for the consent as possible, full custody for the proof', async () => {
    const lists = await checklist('brazilian-with-a-shared-custody-child-and-a-full-custody-child');
    expect(pick(lists, 'p2')).toEqual(
      row(false, false, 'unknown', 'unknown', 'unknown', false, false),
    );
    expect(pick(lists, 'p3')).toEqual(row(false, false, 'unknown', false, false, true, false));
  }, 120_000);

  it('a partner hands in the cohabitation proof, and a partnership certificate only if registered', async () => {
    const lists = await checklist('brazilian-with-a-partner-of-three-years');
    expect(pick(lists, 'p2')).toEqual(row('unknown', true, false, false, false, false, false));
  }, 120_000);

  it('a dependent parent documents the dependence, as a possible dependent', async () => {
    const lists = await checklist('parent-depending-on-the-principal-possible');
    expect(pick(lists, 'p2')).toEqual(row(false, false, false, false, false, false, 'unknown'));
  }, 120_000);

  it('married dependent parents still document their dependence, as possible', async () => {
    const lists = await checklist('married-parents-depending-on-the-principal-possible');
    for (const parent of ['p2', 'p3']) {
      expect(lists[parent]?.['dependence-proof-dependent']).toBe('unknown');
    }
  }, 120_000);
});
