import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ReadPage, checkItems } from '@arca/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Evidence,
  type ReviewDirs,
  type ReviewedVersion,
  evidenceProblems,
  quotedPages,
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
});

describe('migrations that store rule versions or decisions (ADR-0032)', () => {
  /** The migration that admitted the `session_review` proof: the scan starts after it. */
  const admitted = '20261120021312_knowledge_session_review_decisions_grants';
  const writesRules =
    /session_review|\b(insert\s+into|update|delete\s+from|truncate|copy)\s+(only\s+)?"?knowledge"?\s*\.\s*"?(decision|route_version)\b/iu;

  it('are only the generated migrations of the listed reviews', async () => {
    const reviews = new Set(sessionReviews.map(({ migration }) => migration));
    const later = (await readdir(migrationsDir)).filter((name) => name > admitted);
    const writing: string[] = [];
    for (const name of later) {
      const sql = await readFile(join(migrationsDir, name, 'migration.sql'), 'utf8');
      if (writesRules.test(sql)) writing.push(name.replace(/^\d+_/u, ''));
    }
    expect(writing.filter((name) => !reviews.has(name))).toEqual([]);
  });
});

describe('the evidence of a reviewed version', () => {
  let version: ReviewedVersion;
  let evidence: Evidence;
  beforeAll(async () => {
    const review = sessionReviews[0];
    if (review === undefined) throw new Error('No session review');
    const [first] = await reviewedVersions(dirs, review);
    if (first === undefined) throw new Error('No reviewed version');
    version = first;
    evidence = await readEvidence(dirs.reviewsDir, review, first.routeId, first.number);
  }, buildTimeout);

  const problemsOf = (changed: Evidence, pages?: ReadonlyMap<string, ReadPage>) =>
    evidenceProblems(version.entry, changed, pages ?? quotedPages(changed));
  const quotesOf = (key: string) => evidence.quotes.filter((quote) => quote.key === key);
  const without = (key: string) => evidence.quotes.filter((quote) => quote.key !== key);
  const valued = () => {
    const item = checkItems(version.entry).find(({ values }) => values.length > 0);
    if (item === undefined) throw new Error('No item states a value');
    return item.key;
  };

  it('holds as committed', () => {
    expect(problemsOf(evidence)).toEqual([]);
  });

  it('needs a quote for every item', () => {
    const key = valued();
    expect(problemsOf({ ...evidence, quotes: without(key) })).toEqual([`${key}: quote_count`]);
  });

  it('refuses a quote on a page its item does not cite, and one of no item', () => {
    const key = valued();
    const [first] = quotesOf(key);
    if (first === undefined) throw new Error('No quote');
    const elsewhere = { ...first, url: 'https://example.com/not-cited' };
    expect(problemsOf({ ...evidence, quotes: [...without(key), elsewhere] })).toEqual([
      `${key}: url_not_cited`,
    ]);
    const stray = { ...first, key: 'requirement:no-such-item' };
    expect(problemsOf({ ...evidence, quotes: [...evidence.quotes, stray] })).toEqual([
      'requirement:no-such-item: No such item',
    ]);
  });

  it('refuses more quotes than the app reads for an item', () => {
    const key = valued();
    const [first] = quotesOf(key);
    if (first === undefined) throw new Error('No quote');
    const many = Array.from({ length: 6 }, () => first);
    expect(problemsOf({ ...evidence, quotes: [...without(key), ...many] })).toEqual([
      `${key}: quote_count`,
    ]);
  });

  it('refuses quotes that do not state the value the item gives', () => {
    const key = valued();
    const [first] = quotesOf(key);
    if (first === undefined) throw new Error('No quote');
    const beside = { ...first, quote: 'A sentence of the page that states no amount at all.' };
    expect(problemsOf({ ...evidence, quotes: [...without(key), beside] })).toEqual([
      `${key}: value_not_in_quote`,
    ]);
  });

  it('refuses a quote the page read does not hold, and a page that was cut', () => {
    const pages = quotedPages(evidence);
    const key = valued();
    const [first] = quotesOf(key);
    if (first === undefined) throw new Error('No quote');
    const page = pages.get(first.url);
    if (page === undefined) throw new Error('No page');
    const other = new Map(pages).set(first.url, { ...page, text: 'Another text altogether.' });
    expect(problemsOf(evidence, other)).toContain(`${key}: quote_not_on_page`);
    const cut = new Map(pages).set(first.url, { ...page, cut: true });
    expect(problemsOf(evidence, cut)).toContain(`${key}: page_cut`);
  });
});
