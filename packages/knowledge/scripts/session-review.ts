import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type CatalogEntry,
  type CheckAnswer,
  type CheckItem,
  type ReadPage,
  asDataText,
  checkItems,
  machineReadableUrls,
  maxKnowledgeJsonDepth,
  maxQuoteLength,
  minQuoteLength,
  pageLanguages,
  routeVersionSchema,
  verifyAnswers,
} from '@arca/domain';
import { hostOf } from '@arca/scripts/host';
import { parseJsonSubset } from '@arca/scripts/json';
import { z } from 'zod';
import type { Json } from '../src/canonical.ts';
import { checkProposal } from '../src/proposal.ts';
import {
  type RouteVersionRow,
  type RuleRowReading,
  type RuleRows,
  casesHashOf,
} from '../src/rule-rows.ts';
import { buildKnowledge, formatIssue } from './build.ts';
import { inlinedRows } from './inline-cases.ts';
import { readKnowledgeFile } from './load.ts';
import { importDate } from './rule-import.ts';
import { json, literal } from './sql.ts';

/**
 * One session review (ADR-0032): the route versions a Claude Code session the owner asked for
 * wrote after reading the official sources, kept under `reviews/<id>` and stored, already active,
 * by the migration it names. The test writes that migration (`vitest -u`) and compares it in CI.
 */
export interface SessionReview {
  readonly id: string;
  readonly migration: string;
  readonly versions: readonly { readonly routeId: string; readonly number: number }[];
}

/** Every session review, oldest first: a later one is checked against the rows of the earlier. */
export const sessionReviews: readonly SessionReview[] = [
  {
    id: '2026-11-us',
    migration: 'knowledge_session_review_2026_11_us',
    versions: [{ routeId: 'us-eb5', number: 9 }],
  },
  {
    id: '2026-11-pt',
    migration: 'knowledge_session_review_2026_11_pt',
    versions: [
      { routeId: 'pt-d7', number: 7 },
      { routeId: 'pt-d8', number: 7 },
    ],
  },
  {
    id: '2026-11-es',
    migration: 'knowledge_session_review_2026_11_es',
    versions: [{ routeId: 'es-non-lucrative', number: 4 }],
  },
  {
    id: '2026-11-it',
    migration: 'knowledge_session_review_2026_11_it',
    versions: [
      { routeId: 'it-descent', number: 6 },
      { routeId: 'it-descent', number: 7 },
    ],
  },
  {
    id: '2026-11-pl',
    migration: 'knowledge_session_review_2026_11_pl',
    versions: [{ routeId: 'pl-descent', number: 3 }],
  },
  {
    id: '2026-11-lv',
    migration: 'knowledge_session_review_2026_11_lv',
    versions: [{ routeId: 'lv-capital-investment', number: 5 }],
  },
];

/** A reviewed version as its migration stores it, with the hash of its cases the decision binds. */
export interface ReviewedVersion extends RouteVersionRow {
  readonly cases: Json;
  readonly casesHash: string;
  readonly entry: CatalogEntry;
  /** The hosts of the official-domain lists an item pins, as the proposal check read them. */
  readonly officialHosts: (pins: CheckItem['officialDomains']) => readonly string[] | undefined;
}

/** An official passage an item rests on, copied from a page the item cites. */
const evidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  quotes: z
    .array(
      z.strictObject({
        key: z.string().min(1),
        url: z.url(),
        quote: z.string().min(minQuoteLength).max(maxQuoteLength),
      }),
    )
    .min(1),
});
export type Evidence = z.infer<typeof evidenceSchema>;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const readJson = async (path: string): Promise<Json> =>
  parseJsonSubset(await readKnowledgeFile(path), maxKnowledgeJsonDepth);

const fileOf = (reviewsDir: string, review: SessionReview, routeId: string, number: number) =>
  join(reviewsDir, review.id, `${routeId}.${String(number)}`);

/**
 * Why a version's evidence does not hold, one line per problem, by the app's own quote check
 * (`verifyAnswers`, ADR-0031): every item matches on one to `maxQuotes` quotes, each on the text
 * of a page the item cites, and its quotes state every value the item gives.
 */
export function evidenceProblems(
  entry: CatalogEntry,
  evidence: Evidence,
  pages: ReadonlyMap<string, ReadPage>,
): string[] {
  const items = checkItems(entry);
  const keys = new Set(items.map((item) => item.key));
  const answers: CheckAnswer[] = items.map(({ key }) => ({
    key,
    status: 'matches',
    quotes: evidence.quotes
      .filter((quote) => quote.key === key)
      .map(({ url, quote }) => ({ url, quote: asDataText(quote) })),
  }));
  return [
    ...evidence.quotes.filter(({ key }) => !keys.has(key)).map(({ key }) => `${key}: No such item`),
    ...verifyAnswers(items, answers, pages, pageLanguages(entry.version.country))
      .filter((checked) => checked.status !== 'matches')
      .map((checked) => `${checked.key}: ${checked.reason ?? checked.status}`),
  ];
}

/**
 * Each cited page as its quotes alone, so the check runs with no network: it then proves the
 * quotes are well formed, cited and state the item's values, not that a page holds them. The
 * `review-quotes` job reads the pages themselves. A page's chain is the address the app would
 * request for it, its machine-readable address when `machineReadable` names one, since that is the
 * address the echo rule reads.
 */
export function quotedPages(
  evidence: Evidence,
  machineReadable: ReadonlyMap<string, string> = new Map(),
): Map<string, ReadPage> {
  const texts = new Map<string, string[]>();
  for (const { url, quote } of evidence.quotes) {
    texts.set(url, [...(texts.get(url) ?? []), asDataText(quote)]);
  }
  return new Map(
    [...texts].map(([url, quotes]) => [
      url,
      { url, text: quotes.join('\n'), cut: false, chain: [machineReadable.get(url) ?? url] },
    ]),
  );
}

/** The evidence file of a reviewed version, parsed. */
export async function readEvidence(
  reviewsDir: string,
  review: SessionReview,
  routeId: string,
  number: number,
): Promise<Evidence> {
  return evidenceSchema.parse(
    await readJson(`${fileOf(reviewsDir, review, routeId, number)}.evidence.json`),
  );
}

export interface ReviewDirs {
  readonly dataDir: string;
  readonly familiesDir: string;
  readonly reviewsDir: string;
}

/**
 * A review's versions, each checked as the app checks an update request's proposal
 * (`checkProposal`: schema, order, pinned files, cases and coverage) against the rows the database
 * holds when its migration runs: the import, with its cases inline, and every earlier review. A
 * version that fails, or whose evidence does not cover it, throws with its problems.
 */
export async function reviewedVersions(
  dirs: ReviewDirs,
  review: SessionReview,
): Promise<ReviewedVersion[]> {
  const { issues, rows: imported, countryFiles } = await buildKnowledge(dirs.dataDir, importDate);
  if (issues.length > 0) throw new Error(issues.map(formatIssue).join('\n'));
  const reading: RuleRowReading = { countryFiles, sha256, hostOf };
  const inlined = new Map(
    (await inlinedRows(imported, dirs.familiesDir)).map((row) => [
      `${row.routeId}/${String(row.number)}`,
      row.inlined,
    ]),
  );
  let rows: RuleRows = {
    ...imported,
    routeVersions: imported.routeVersions.map((row) => ({
      ...row,
      cases: inlined.get(`${row.routeId}/${String(row.number)}`) ?? row.cases,
    })),
  };
  let reviewed: ReviewedVersion[] = [];
  const position = sessionReviews.indexOf(review);
  if (position === -1) throw new Error(`Review ${review.id} is not listed`);
  for (const each of sessionReviews.slice(0, position + 1)) {
    reviewed = [];
    for (const { routeId, number } of each.versions) {
      const path = fileOf(dirs.reviewsDir, each, routeId, number);
      const content = await readJson(`${path}.json`);
      const cases = await readJson(`${path}.cases.json`);
      const base = rows.routeVersions
        .filter((row) => row.routeId === routeId)
        .reduce<RouteVersionRow | undefined>(
          (newest, row) => (newest === undefined || row.number > newest.number ? row : newest),
          undefined,
        );
      if (base === undefined) throw new Error(`${path}: A review updates a stored route`);
      const checked = await checkProposal(
        rows,
        { kind: 'update', base: routeVersionSchema.parse(base.content) },
        content,
        cases,
        reading,
      );
      if (!checked.ok) throw new Error(`${path}:\n${checked.problems.join('\n')}`);
      if (checked.entry.version.number !== number) throw new Error(`${path}: Its number`);
      const evidence = await readEvidence(dirs.reviewsDir, each, routeId, number);
      const gaps = evidenceProblems(
        checked.entry,
        evidence,
        quotedPages(evidence, machineReadableUrls(checked.entry)),
      );
      if (gaps.length > 0) throw new Error(`${path}.evidence.json:\n${gaps.join('\n')}`);
      const row: ReviewedVersion = {
        routeId,
        number,
        content,
        contentHash: checked.hash,
        cases,
        casesHash: casesHashOf(cases, reading),
        entry: checked.entry,
        officialHosts: checked.officialHosts,
      };
      reviewed.push(row);
      rows = { ...rows, routeVersions: [...rows.routeVersions, row] };
    }
  }
  return reviewed;
}

/**
 * A review as SQL: it stores each version, which fails, and with it the whole migration, when the
 * database already holds one under that ID and number, and records its activation as a
 * `session_review` decision bound to the content and cases hashes (ADR-0032).
 */
export function reviewSql(review: SessionReview, versions: readonly ReviewedVersion[]): string {
  return [
    `-- Generated by packages/knowledge/scripts/session-review.ts from
-- packages/knowledge/reviews/${review.id}. Do not edit. Route versions a session review wrote
-- and checked against the official sources, stored and activated with no admin step (ADR-0032).
INSERT INTO "knowledge"."route_version" (route_id, number, content, content_hash, cases) VALUES
${versions.map((row) => `  (${literal(row.routeId)}, ${String(row.number)}, ${json(row.content)}, ${literal(row.contentHash)}, ${json(row.cases)})`).join(',\n')};`,
    `INSERT INTO "knowledge"."decision" (kind, subject_kind, route_id, version_number, content_hash, cases_hash, proof) VALUES
${versions.map((row) => `  ('activate', 'route', ${literal(row.routeId)}, ${String(row.number)}, ${literal(row.contentHash)}, ${literal(row.casesHash)}, 'session_review')`).join(',\n')};`,
  ]
    .join('\n--> statement-breakpoint\n')
    .concat('\n');
}

/** A review's migration file under `packages/db/migrations`. */
export async function reviewMigrationFile(
  migrationsDir: string,
  review: SessionReview,
): Promise<string> {
  const folders = (await readdir(migrationsDir)).filter(
    (name) => name.replace(/^\d+_/u, '') === review.migration,
  );
  const [folder] = folders;
  // A second folder under the name would be a migration the comparison never reads.
  if (folder === undefined || folders.length > 1) {
    throw new Error(
      `${review.migration} needs one migration folder, found ${String(folders.length)}`,
    );
  }
  return join(migrationsDir, folder, 'migration.sql');
}
