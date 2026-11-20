import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type CatalogEntry,
  checkItems,
  machineReadableUrls,
  maxKnowledgeJsonDepth,
  maxQuoteLength,
  maxQuotes,
  minQuoteLength,
  normalizeWhitespace,
  routeVersionSchema,
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
];

/** A reviewed version as its migration stores it, with the hash of its cases the decision binds. */
export interface ReviewedVersion extends RouteVersionRow {
  readonly cases: Json;
  readonly casesHash: string;
  readonly entry: CatalogEntry;
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

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown): string => `${literal(JSON.stringify(value))}::jsonb`;
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const readJson = async (path: string): Promise<Json> =>
  parseJsonSubset(await readKnowledgeFile(path), maxKnowledgeJsonDepth);

const fileOf = (reviewsDir: string, review: SessionReview, routeId: string, number: number) =>
  join(reviewsDir, review.id, `${routeId}.${String(number)}`);

/**
 * Why a version's evidence does not cover it, one line per problem: every item the quote check
 * would read has one to `maxQuotes` quotes, and each quote is on a page its item cites.
 */
export function evidenceProblems(entry: CatalogEntry, evidence: Evidence): string[] {
  const items = new Map(checkItems(entry).map((item) => [item.key, item]));
  const problems: string[] = [];
  for (const { key, url } of evidence.quotes) {
    const item = items.get(key);
    if (item === undefined) problems.push(`${key}: No such item`);
    else if (!item.urls.includes(url)) problems.push(`${key}: ${url} is not a page it cites`);
  }
  const quoted = new Map<string, number>();
  for (const { key } of evidence.quotes) quoted.set(key, (quoted.get(key) ?? 0) + 1);
  for (const key of items.keys()) {
    const count = quoted.get(key) ?? 0;
    if (count === 0) problems.push(`${key}: No quote`);
    if (count > maxQuotes) problems.push(`${key}: More than ${String(maxQuotes)} quotes`);
  }
  return problems;
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
  const index = sessionReviews.indexOf(review);
  let reviewed: ReviewedVersion[] = [];
  for (const each of index === -1 ? [review] : sessionReviews.slice(0, index + 1)) {
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
      const gaps = evidenceProblems(
        checked.entry,
        await readEvidence(dirs.reviewsDir, each, routeId, number),
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
      };
      reviewed.push(row);
      rows = { ...rows, routeVersions: [...rows.routeVersions, row] };
    }
  }
  return reviewed;
}

/**
 * A review as SQL: it aborts when a stored row under a reviewed ID and number has another hash,
 * stores each version, keeping a row already stored, and records its activation as a
 * `session_review` decision bound to the content and cases hashes (ADR-0032).
 */
export function reviewSql(review: SessionReview, versions: readonly ReviewedVersion[]): string {
  return [
    `-- Generated by packages/knowledge/scripts/session-review.ts from
-- packages/knowledge/reviews/${review.id}. Do not edit. Route versions a session review wrote
-- and checked against the official sources, stored and activated with no admin step (ADR-0032).
DO $check$
BEGIN
  IF EXISTS (
    SELECT FROM (VALUES
${versions.map(({ routeId, number, contentHash }) => `      (${literal(routeId)}, ${String(number)}, ${literal(contentHash)})`).join(',\n')}
    ) AS reviewed (route_id, number, content_hash)
    JOIN "knowledge"."route_version" AS stored
      ON stored.route_id = reviewed.route_id AND stored.number = reviewed.number
    WHERE stored.content_hash <> reviewed.content_hash
  ) THEN
    RAISE EXCEPTION 'knowledge session review: a stored route version has another content hash';
  END IF;
END
$check$;`,
    `INSERT INTO "knowledge"."route_version" (route_id, number, content, content_hash, cases) VALUES
${versions.map((row) => `  (${literal(row.routeId)}, ${String(row.number)}, ${json(row.content)}, ${literal(row.contentHash)}, ${json(row.cases)})`).join(',\n')}
ON CONFLICT (route_id, number) DO NOTHING;`,
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
  const folder = (await readdir(migrationsDir)).find((name) =>
    name.endsWith(`_${review.migration}`),
  );
  if (folder === undefined) throw new Error(`No ${review.migration} migration folder`);
  return join(migrationsDir, folder, 'migration.sql');
}

const entities: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  sect: '§',
  mdash: '—',
  ndash: '–',
};

/** A fetched page as plain text: markup dropped, common entities read, whitespace as one space. */
export function pageText(html: string): string {
  const text = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/giu, (whole, name: string) => entities[name.toLowerCase()] ?? whole);
  return normalizeWhitespace(text);
}

/**
 * Reads each cited page once, from its machine-readable address when the source gives one, and
 * names every quote that is not on its page. Needs the network, so a session runs it, not CI.
 */
export async function quoteProblems(
  version: ReviewedVersion,
  evidence: Evidence,
): Promise<string[]> {
  const readable = machineReadableUrls(version.entry);
  const pages = new Map<string, Promise<string>>();
  const page = (url: string) => {
    let known = pages.get(url);
    if (known === undefined) {
      known = fetch(readable.get(url) ?? url, { redirect: 'error' }).then(async (answer) => {
        if (!answer.ok) throw new Error(`${url}: HTTP ${String(answer.status)}`);
        return pageText(await answer.text());
      });
      pages.set(url, known);
    }
    return known;
  };
  const problems: string[] = [];
  for (const { key, url, quote } of evidence.quotes) {
    if (!(await page(url)).includes(normalizeWhitespace(quote))) {
      problems.push(`${key}: The quote is not on ${url}`);
    }
  }
  return problems;
}
