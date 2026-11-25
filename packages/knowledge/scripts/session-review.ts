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
  routeCountry,
  routeVersionSchema,
  verifyAnswers,
} from '@arca/domain';
import { hostOf } from '@arca/scripts/host';
import { parseJsonSubset } from '@arca/scripts/json';
import { z } from 'zod';
import type { Json } from '../src/canonical.ts';
import { type ProposalTarget, checkProposal } from '../src/proposal.ts';
import {
  type RouteVersionRow,
  type RuleRowReading,
  type RuleRows,
  casesHashOf,
  countryPins,
} from '../src/rule-rows.ts';
import { formatIssue } from './build.ts';
import { inlinedRows } from './inline-cases.ts';
import { readKnowledgeFile } from './load.ts';
import { importBuild } from './rule-import.ts';
import { json, literal } from './sql.ts';

/** A version a review lists: the next of a stored route, or the first of a route it names as new. */
export interface ListedVersion {
  readonly routeId: string;
  readonly number: number;
  /** The route is not stored yet, and this is its first version (ADR-0032, amended 2026-11-25). */
  readonly newRoute?: true;
}

/**
 * One session review (ADR-0032): the route versions a Claude Code session the owner asked for
 * wrote after reading the official sources, kept under `reviews/<id>` and stored, already active,
 * by the migration it names. The test writes that migration (`vitest -u`) and compares it in CI.
 */
export interface SessionReview {
  readonly id: string;
  readonly migration: string;
  readonly versions: readonly ListedVersion[];
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
  {
    id: '2026-11-au',
    migration: 'knowledge_session_review_2026_11_au',
    versions: [{ routeId: 'au-skilled-independent', number: 3 }],
  },
  {
    id: '2026-11-jp',
    migration: 'knowledge_session_review_2026_11_jp',
    versions: [
      { routeId: 'jp-nikkei-long-term-resident', number: 3 },
      { routeId: 'jp-nikkei-long-term-resident', number: 4 },
    ],
  },
  {
    id: '2026-11-ar',
    migration: 'knowledge_session_review_2026_11_ar',
    versions: [
      { routeId: 'ar-mercosur-temporary', number: 4 },
      { routeId: 'ar-mercosur-temporary', number: 5 },
    ],
  },
  {
    id: '2026-11-py',
    migration: 'knowledge_session_review_2026_11_py',
    versions: [{ routeId: 'py-mercosur-temporary', number: 4 }],
  },
  {
    id: '2026-11-uy',
    migration: 'knowledge_session_review_2026_11_uy',
    versions: [
      { routeId: 'uy-mercosur-permanent', number: 4 },
      { routeId: 'uy-mercosur-permanent', number: 5 },
      { routeId: 'uy-mercosur-permanent', number: 6 },
    ],
  },
  {
    id: '2026-11-cl',
    migration: 'knowledge_session_review_2026_11_cl',
    versions: [{ routeId: 'cl-mercosur-temporary', number: 5 }],
  },
  {
    id: '2026-11-dk',
    migration: 'knowledge_session_review_2026_11_dk',
    versions: [{ routeId: 'dk-pay-limit', number: 3 }],
  },
  {
    id: '2026-11-ge',
    migration: 'knowledge_session_review_2026_11_ge',
    versions: [{ routeId: 'ge-property-short-term', number: 3 }],
  },
  {
    id: '2026-11-cz',
    migration: 'knowledge_session_review_2026_11_cz',
    versions: [{ routeId: 'cz-eu-blue-card', number: 5 }],
  },
  {
    id: '2026-11-gb',
    migration: 'knowledge_session_review_2026_11_gb',
    versions: [{ routeId: 'gb-skilled-worker', number: 3 }],
  },
  {
    id: '2026-11-ie',
    migration: 'knowledge_session_review_2026_11_ie',
    versions: [{ routeId: 'ie-critical-skills', number: 4 }],
  },
  {
    id: '2026-11-us-documents',
    migration: 'knowledge_session_review_2026_11_us_documents',
    versions: [{ routeId: 'us-eb5', number: 10 }],
  },
  {
    id: '2026-11-pt-documents',
    migration: 'knowledge_session_review_2026_11_pt_documents',
    versions: [
      { routeId: 'pt-d7', number: 8 },
      { routeId: 'pt-d8', number: 8 },
    ],
  },
  {
    id: '2026-11-us-routes',
    migration: 'knowledge_session_review_2026_11_us_routes',
    versions: [
      { routeId: 'us-eb2-niw', number: 1, newRoute: true },
      { routeId: 'us-l1a', number: 1, newRoute: true },
      { routeId: 'us-eb1c', number: 1, newRoute: true },
    ],
  },
  {
    id: '2026-11-es-documents',
    migration: 'knowledge_session_review_2026_11_es_documents',
    versions: [{ routeId: 'es-non-lucrative', number: 5 }],
  },
  {
    id: '2026-11-es-telework',
    migration: 'knowledge_session_review_2026_11_es_telework',
    versions: [{ routeId: 'es-international-telework', number: 1, newRoute: true }],
  },
  {
    id: '2026-11-pl-documents',
    migration: 'knowledge_session_review_2026_11_pl_documents',
    versions: [{ routeId: 'pl-descent', number: 4 }],
  },
  {
    id: '2026-11-pt-d2',
    migration: 'knowledge_session_review_2026_11_pt_d2',
    versions: [{ routeId: 'pt-d2', number: 1, newRoute: true }],
  },
  {
    id: '2026-11-lv-documents',
    migration: 'knowledge_session_review_2026_11_lv_documents',
    versions: [{ routeId: 'lv-capital-investment', number: 6 }],
  },
  {
    id: '2026-11-au-documents',
    migration: 'knowledge_session_review_2026_11_au_documents',
    versions: [{ routeId: 'au-skilled-independent', number: 4 }],
  },
  {
    id: '2026-11-us-employer',
    migration: 'knowledge_session_review_2026_11_us_employer',
    versions: [
      { routeId: 'us-eb3', number: 1, newRoute: true },
      { routeId: 'us-eb2-job-offer', number: 1, newRoute: true },
    ],
  },
  {
    id: '2026-11-lv-remote-work',
    migration: 'knowledge_session_review_2026_11_lv_remote_work',
    versions: [{ routeId: 'lv-remote-work', number: 1, newRoute: true }],
  },
  {
    id: '2026-11-pt-d3',
    migration: 'knowledge_session_review_2026_11_pt_d3',
    versions: [{ routeId: 'pt-d3', number: 1, newRoute: true }],
  },
  {
    id: '2026-11-jp-documents',
    migration: 'knowledge_session_review_2026_11_jp_documents',
    versions: [
      { routeId: 'jp-nikkei-long-term-resident', number: 5 },
      { routeId: 'jp-nikkei-long-term-resident', number: 6 },
    ],
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
  const items = checkItems(entry, { documents: true });
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

/**
 * What a listed version is checked as (ADR-0032): the next version of the route's newest stored
 * one, or, for a route the listing names as new, the first version of a route of its ID's country
 * on the official-domain lists that country's stored versions already pin. A review adds no list
 * and no host, so a country with no stored route is out of its reach, and so is an ID that is
 * new without the listing saying so, which a mistyped ID would be.
 */
export function reviewTarget(
  rows: RuleRows,
  reading: RuleRowReading,
  listed: ListedVersion,
): ProposalTarget {
  const base = rows.routeVersions
    .filter((row) => row.routeId === listed.routeId)
    .reduce<RouteVersionRow | undefined>(
      (newest, row) => (newest === undefined || row.number > newest.number ? row : newest),
      undefined,
    );
  if (listed.newRoute !== true) {
    if (base === undefined) {
      throw new Error('A review updates a stored route, or lists the route as new');
    }
    return { kind: 'update', base: routeVersionSchema.parse(base.content) };
  }
  if (base !== undefined) throw new Error('A route listed as new has an ID no stored route has');
  const country = routeCountry(listed.routeId);
  const pins = countryPins(rows, reading, new Map()).get(country) ?? [];
  if (pins.length === 0) {
    throw new Error(
      'A new route is of a country whose stored routes pin an approved official-domain list',
    );
  }
  return { kind: 'new', country, pins };
}

export interface ReviewDirs {
  readonly dataDir: string;
  readonly familiesDir: string;
  readonly reviewsDir: string;
}

/** The rows the one-time import stored (ADR-0031), and how a read verifies them. */
export async function importedRows(
  dataDir: string,
): Promise<{ readonly rows: RuleRows; readonly reading: RuleRowReading }> {
  const { issues, rows, datasetFiles } = await importBuild(dataDir);
  if (issues.length > 0) throw new Error(issues.map(formatIssue).join('\n'));
  return { rows, reading: { datasetFiles, sha256, hostOf } };
}

/**
 * A review's versions, each checked as the app checks a request's proposal (`checkProposal`:
 * schema, where it stands, pinned files, cases and coverage; an update request's for a stored
 * route, a new-route request's for a route listed as new) against the rows the database holds when
 * its migration runs: the import, with its cases inline, and every earlier review. A version that
 * fails, or whose evidence does not cover it, throws with its problems.
 */
export async function reviewedVersions(
  dirs: ReviewDirs,
  review: SessionReview,
): Promise<ReviewedVersion[]> {
  const { rows: imported, reading } = await importedRows(dirs.dataDir);
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
    for (const listed of each.versions) {
      const { routeId, number } = listed;
      const path = fileOf(dirs.reviewsDir, each, routeId, number);
      const content = await readJson(`${path}.json`);
      const cases = await readJson(`${path}.cases.json`);
      let target: ProposalTarget;
      try {
        target = reviewTarget(rows, reading, listed);
      } catch (error) {
        throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
      const checked = await checkProposal(rows, target, content, cases, reading);
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
