import { randomUUID } from 'node:crypto';
import {
  type CheckStart,
  type ReportKey,
  type ReportMeta,
  startWindow,
  versionKey,
  versionsToStart,
} from '@arca/domain';
import { type Database, lockKey } from '@arca/db';
import { checkStart, independentCheck } from '@arca/db/knowledge-schema';
import { gte, sql } from 'drizzle-orm';
import { type CheckReportStore, listingColumns } from './store.js';

/** A version the screen asks to check, with what its report would answer for. */
export interface StartRequest {
  readonly routeId: string;
  readonly number: number;
  readonly key: ReportKey;
}

export interface RecordedStart extends CheckStart {
  readonly routeId: string;
  readonly number: number;
}

/** The start ledger (ADR-0027): at most 20 starts in any 24 hours, never two live for a version. */
export interface CheckStarts {
  /** Records a start for each requested version that is due, in order, within what is left. */
  readonly begin: (requests: readonly StartRequest[]) => Promise<readonly RecordedStart[]>;
  /** The starts of the last 24 hours, for the list's running status. */
  readonly recent: () => Promise<readonly RecordedStart[]>;
}

function grouped<T extends { routeId: string; number: number }>(rows: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows)
    groups.set(versionKey(row), [...(groups.get(versionKey(row)) ?? []), row]);
  return (version: { routeId: string; number: number }) => groups.get(versionKey(version)) ?? [];
}

/** Which requests to start, from the starts of the window and every report. */
function due(
  requests: readonly StartRequest[],
  starts: readonly RecordedStart[],
  reports: readonly (ReportMeta & { routeId: string; number: number })[],
  now: number,
): StartRequest[] {
  const startsOf = grouped(starts);
  const reportsOf = grouped(reports);
  return versionsToStart(
    requests.map((request) => ({
      ...request,
      starts: startsOf(request),
      reports: reportsOf(request),
    })),
    starts.length,
    now,
  );
}

/** For tests: kept while the process runs, reading reports from the memory store. */
export function memoryCheckStarts(
  reports: CheckReportStore,
  now: () => number = Date.now,
): CheckStarts & { readonly rows: RecordedStart[] } {
  const rows: RecordedStart[] = [];
  const recent = () => rows.filter((row) => now() - row.startedAt < startWindow);
  return {
    rows,
    begin: async (requests) => {
      const started = due(requests, recent(), await reports.list(), now()).map(
        ({ routeId, number }) => ({ id: randomUUID(), routeId, number, startedAt: now() }),
      );
      rows.push(...started);
      return started;
    },
    recent: () => Promise.resolve(recent()),
  };
}

const startColumns = {
  id: checkStart.id,
  routeId: checkStart.routeId,
  number: checkStart.versionNumber,
  startedAt: checkStart.startedAt,
};

/**
 * `knowledge.check_start` on the app_api pool. A start is decided and recorded in one transaction
 * under an environment-wide advisory lock, on the database's clock, so concurrent screens on any
 * instance neither pass the cap nor start a version twice.
 */
export function postgresCheckStarts(db: () => Database): CheckStarts {
  const since = sql`clock_timestamp() - interval '24 hours'`;
  return {
    begin: (requests) =>
      db().transaction(async (tx) => {
        await lockKey(tx, 'knowledge.check_start');
        const [clock] = (
          await tx.execute<{ now: number }>(
            sql`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now`,
          )
        ).rows;
        const now = Number(clock?.now);
        const starts = (
          await tx.select(startColumns).from(checkStart).where(gte(checkStart.startedAt, since))
        ).map((row) => ({ ...row, startedAt: row.startedAt.getTime() }));
        const reports = (await tx.select(listingColumns).from(independentCheck)).map((row) => ({
          ...row,
          checkedAt: row.checkedAt.getTime(),
        }));
        const picked = due(requests, starts, reports, now);
        if (picked.length === 0) return [];
        // Raw SQL: the role may insert the route and number only, which a builder insert would
        // widen with DEFAULT for the ID and the time.
        const inserted: RecordedStart[] = [];
        for (const { routeId, number } of picked) {
          const [row] = (
            await tx.execute<{ id: string; started_at: number }>(sql`
              INSERT INTO knowledge.check_start (route_id, version_number)
              VALUES (${routeId}, ${number})
              RETURNING id, (extract(epoch FROM started_at) * 1000)::float8 AS started_at`)
          ).rows;
          if (row !== undefined) {
            inserted.push({ id: row.id, routeId, number, startedAt: row.started_at });
          }
        }
        return inserted;
      }),
    recent: async () =>
      (
        await db().select(startColumns).from(checkStart).where(gte(checkStart.startedAt, since))
      ).map((row) => ({ ...row, startedAt: row.startedAt.getTime() })),
  };
}
