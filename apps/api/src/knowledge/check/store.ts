import {
  type CheckedItem,
  type ReportMeta,
  type FetchFailure,
  checkFailures,
  checkReasons,
  checkStatuses,
  fetchOutcomes,
  maxCheckItemKeyLength,
  maxNoteLength,
  maxQuoteLength,
  maxQuotes,
} from '@arca/domain';
import type { Database } from '@arca/db';
import { independentCheck } from '@arca/db/knowledge-schema';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RuleCheckerFailure } from './checker.js';

/** One cited URL as the run fetched it (ADR-0027). */
export interface FetchLogEntry {
  readonly url: string;
  readonly outcome: 'read' | FetchFailure;
  readonly status: number | null;
  readonly durationMs: number;
  /** SHA-256 of the text sent to the model, when the page was read. */
  readonly sha256: string | null;
  readonly cut: boolean;
}

/** A stored report and what freshness reads of it. */
export interface CheckReport extends ReportMeta {
  readonly routeId: string;
  readonly number: number;
  readonly items: readonly CheckedItem[];
  readonly fetchLog: readonly FetchLogEntry[];
  readonly failure: RuleCheckerFailure | null;
  readonly clean: boolean;
}

export type ReportListing = Omit<CheckReport, 'items' | 'fetchLog' | 'failure'>;

export type NewCheckReport = Omit<CheckReport, 'checkedAt'>;

/** Reports across instances: written by the check's step, read by the API (ADR-0027). */
export interface CheckReportStore {
  readonly save: (report: NewCheckReport) => Promise<void>;
  /** Every report's identity, key and outcome, without its items. */
  readonly list: () => Promise<readonly ReportListing[]>;
  readonly find: (startId: string) => Promise<CheckReport | undefined>;
}

const url = z.string().max(2_000);
const quote = z.string().max(maxQuoteLength);
const itemFields = {
  key: z.string().max(maxCheckItemKeyLength),
  status: z.enum(checkStatuses),
  note: z.string().max(maxNoteLength).nullable(),
  reason: z.enum(checkReasons).nullable(),
};
/** An item as reports store it since a match may rest on several quotes. */
const quotedItem = z.strictObject({
  ...itemFields,
  quotes: z.array(z.strictObject({ quote, url })).max(maxQuotes),
});
/** An item as reports stored it before (prompt `rule-check-3` and earlier): one quote at most. */
const singleQuoteItem = z
  .strictObject({ ...itemFields, quote: quote.nullable(), url: url.nullable() })
  .transform(({ quote: text, url: page, ...rest }) => ({
    ...rest,
    quotes: text === null || page === null ? [] : [{ quote: text, url: page }],
  }));
const storedItem = z.union([quotedItem, singleQuoteItem]);
const storedFetch = z.strictObject({
  url,
  outcome: z.enum(fetchOutcomes),
  status: z.int().min(0).max(999).nullable(),
  durationMs: z.int().min(0),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  cut: z.boolean(),
});
const storedFailure = z.enum(checkFailures).nullable();

/** For tests: kept while the process runs. */
export function memoryCheckReportStore(now: () => number = Date.now): CheckReportStore & {
  readonly rows: CheckReport[];
} {
  const rows: CheckReport[] = [];
  return {
    rows,
    save: (report) => {
      if (rows.some((row) => row.startId === report.startId)) {
        return Promise.reject(new Error('A start has one report'));
      }
      rows.push({ ...report, checkedAt: now() });
      return Promise.resolve();
    },
    list: () =>
      Promise.resolve(
        rows.map(
          ({
            startId,
            routeId,
            number,
            contentHash,
            guideHash,
            promptVersion,
            model,
            ...rest
          }) => ({
            startId,
            routeId,
            number,
            contentHash,
            guideHash,
            promptVersion,
            model,
            checkedAt: rest.checkedAt,
            failed: rest.failed,
            clean: rest.clean,
          }),
        ),
      ),
    find: (startId) => Promise.resolve(rows.find((row) => row.startId === startId)),
  };
}

/** The columns of a report's listing, for every read that needs no items. */
export const listingColumns = {
  startId: independentCheck.startId,
  routeId: independentCheck.routeId,
  number: independentCheck.versionNumber,
  contentHash: independentCheck.contentHash,
  guideHash: independentCheck.guideHash,
  promptVersion: independentCheck.promptVersion,
  model: independentCheck.model,
  checkedAt: independentCheck.checkedAt,
  failed: independentCheck.failed,
  clean: independentCheck.clean,
};

/**
 * `knowledge.independent_check`: the step inserts on the app_jobs pool, the API reads on the
 * app_api pool. Items and the fetch log are parsed again on the way out, so a row the table's
 * checks let through never reaches the screen in another shape.
 */
export function postgresCheckReportStore(db: () => Database): CheckReportStore {
  return {
    async save(report) {
      // Raw SQL: the role may insert every column but the ID and the time, which a builder insert
      // would name with DEFAULT.
      await db().execute(sql`
        INSERT INTO knowledge.independent_check (start_id, route_id, version_number, content_hash,
          guide_hash, prompt_version, model, items, fetch_log, failure, failed, clean)
        VALUES (${report.startId}, ${report.routeId}, ${report.number}, ${report.contentHash},
          ${report.guideHash}, ${report.promptVersion}, ${report.model},
          ${JSON.stringify(report.items)}::jsonb, ${JSON.stringify(report.fetchLog)}::jsonb,
          ${report.failure}, ${report.failed}, ${report.clean})`);
    },
    async list() {
      const rows = await db()
        .select(listingColumns)
        .from(independentCheck)
        .orderBy(desc(independentCheck.checkedAt));
      return rows.map((row) => ({ ...row, checkedAt: row.checkedAt.getTime() }));
    },
    async find(startId) {
      const [row] = await db()
        .select({
          ...listingColumns,
          items: independentCheck.items,
          fetchLog: independentCheck.fetchLog,
          failure: independentCheck.failure,
        })
        .from(independentCheck)
        .where(eq(independentCheck.startId, startId));
      if (row === undefined) return undefined;
      const items = z.array(storedItem).safeParse(row.items);
      const fetchLog = z.array(storedFetch).safeParse(row.fetchLog);
      const failure = storedFailure.safeParse(row.failure);
      if (!items.success || !fetchLog.success || !failure.success) return undefined;
      return {
        ...row,
        checkedAt: row.checkedAt.getTime(),
        items: items.data,
        fetchLog: fetchLog.data,
        failure: failure.data,
      };
    },
  };
}
