import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type ReviewDirs,
  quoteProblems,
  readEvidence,
  reviewMigrationFile,
  reviewSql,
  reviewedVersions,
  sessionReviews,
} from '../scripts/session-review.ts';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const dirs: ReviewDirs = {
  dataDir: join(packageDir, 'data'),
  familiesDir: join(packageDir, '..', '..', 'eval', 'families'),
  reviewsDir: join(packageDir, 'reviews'),
};
const migrationsDir = join(packageDir, '..', 'db', 'migrations');

// Building the knowledge and running the cases is slow on a busy CI runner.
const buildTimeout = 120_000;

describe.each(sessionReviews)('session review $id (ADR-0032)', (review) => {
  it(
    'passes the proposal check and is the committed migration, generated again',
    async () => {
      const versions = await reviewedVersions(dirs, review);
      expect(versions.map(({ routeId, number }) => ({ routeId, number }))).toEqual(review.versions);
      await expect(reviewSql(review, versions)).toMatchFileSnapshot(
        await reviewMigrationFile(migrationsDir, review),
      );
    },
    buildTimeout,
  );

  // Reads the official pages, so a session runs it: ARCA_REVIEW_QUOTES=<review id>.
  it.skipIf(process.env['ARCA_REVIEW_QUOTES'] !== review.id)(
    'finds every quote of the evidence on the page its item cites',
    async () => {
      for (const version of await reviewedVersions(dirs, review)) {
        const evidence = await readEvidence(
          dirs.reviewsDir,
          review,
          version.routeId,
          version.number,
        );
        expect(await quoteProblems(version, evidence)).toEqual([]);
      }
    },
    buildTimeout * 2,
  );
});
