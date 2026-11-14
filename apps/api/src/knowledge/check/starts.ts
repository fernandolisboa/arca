import { randomUUID } from 'node:crypto';
import {
  type CheckStart,
  type ReportKey,
  type ReportMeta,
  requestedStart,
  type StartShare,
  startWindow,
  versionKey,
  versionsToStart,
} from '@arca/domain';
import { type Database, lockKey } from '@arca/db';
import { checkStart, independentCheck } from '@arca/db/knowledge-schema';
import { gte, sql } from 'drizzle-orm';
import type { CheckProgressStore } from './progress.js';
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

/** An admin's own start: the start now live for the version, and whether this request began it. */
export interface RequestedCheckStart {
  readonly start: RecordedStart;
  readonly began: boolean;
}

/**
 * The start ledger (ADR-0027): automatic starts within their share of any 24 hours, never two
 * live for a version.
 */
export interface CheckStarts {
  /**
   * Records a start for each requested version that is due, in order: an automatic batch within
   * what is left of its share of the cap, an admin's batch with no cap.
   */
  readonly begin: (
    requests: readonly StartRequest[],
    share?: StartShare,
  ) => Promise<readonly RecordedStart[]>;
  /**
   * An admin's start of one version, whatever its reports say: answers its live start when it has
   * one, records a new start otherwise.
   */
  readonly request: (version: {
    readonly routeId: string;
    readonly number: number;
  }) => Promise<RequestedCheckStart>;
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
  share: StartShare,
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
    share,
  );
}

/** For tests: kept while the process runs, reading reports from the memory store. */
export function memoryCheckStarts(
  reports: CheckReportStore,
  now: () => number = Date.now,
  progress?: Pick<CheckProgressStore, 'list'>,
): CheckStarts & { readonly rows: RecordedStart[] } {
  const rows: RecordedStart[] = [];
  const recent = () =>
    Promise.all(
      rows
        .filter((row) => now() - row.startedAt < startWindow)
        .map(async (row) => ({
          ...row,
          failed: ((await progress?.list(row.id)) ?? []).some(({ kind }) => kind === 'failed'),
        })),
    );
  return {
    rows,
    begin: async (requests, share = 'automatic') => {
      const started = due(requests, await recent(), await reports.list(), now(), share).map(
        ({ routeId, number }) => ({ id: randomUUID(), routeId, number, startedAt: now() }),
      );
      rows.push(...started);
      return started;
    },
    request: async ({ routeId, number }) => {
      const decision = requestedStart(
        grouped(await recent())({ routeId, number }),
        await reports.list(),
        now(),
      );
      if (decision.outcome === 'live') return { start: decision.start, began: false };
      const start = { id: randomUUID(), routeId, number, startedAt: now() };
      rows.push(start);
      return { start, began: true };
    },
    recent,
  };
}

const startColumns = {
  id: checkStart.id,
  routeId: checkStart.routeId,
  number: checkStart.versionNumber,
  startedAt: checkStart.startedAt,
  failed: sql<boolean>`EXISTS (SELECT 1 FROM knowledge.check_progress p
    WHERE p.start_id = ${checkStart.id} AND p.kind = 'failed')`,
};

/**
 * `knowledge.check_start` on the app_api pool. A start is decided and recorded in one transaction
 * under an environment-wide advisory lock, on the database's clock, so concurrent screens on any
 * instance neither pass the automatic share nor start a version twice.
 */
export function postgresCheckStarts(db: () => Database): CheckStarts {
  const since = sql`clock_timestamp() - interval '24 hours'`;
  type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
  /** Under the lock: the database's time, the starts of the window and every report. */
  const ledger = async (tx: Transaction) => {
    await lockKey(tx, 'knowledge.check_start');
    const [clock] = (
      await tx.execute<{ now: number }>(
        sql`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now`,
      )
    ).rows;
    const starts = (
      await tx.select(startColumns).from(checkStart).where(gte(checkStart.startedAt, since))
    ).map((row) => ({ ...row, startedAt: row.startedAt.getTime() }));
    const reports = (await tx.select(listingColumns).from(independentCheck)).map((row) => ({
      ...row,
      checkedAt: row.checkedAt.getTime(),
    }));
    return { now: Number(clock?.now), starts, reports };
  };
  // Raw SQL: the role may insert the route and number only, which a builder insert would widen
  // with DEFAULT for the ID and the time.
  const insert = async (
    tx: Transaction,
    { routeId, number }: { readonly routeId: string; readonly number: number },
  ): Promise<RecordedStart | undefined> => {
    const [row] = (
      await tx.execute<{ id: string; started_at: number }>(sql`
        INSERT INTO knowledge.check_start (route_id, version_number)
        VALUES (${routeId}, ${number})
        RETURNING id, (extract(epoch FROM started_at) * 1000)::float8 AS started_at`)
    ).rows;
    return row === undefined
      ? undefined
      : { id: row.id, routeId, number, startedAt: row.started_at };
  };
  return {
    begin: (requests, share = 'automatic') =>
      db().transaction(async (tx) => {
        const { now, starts, reports } = await ledger(tx);
        const inserted: RecordedStart[] = [];
        for (const request of due(requests, starts, reports, now, share)) {
          const start = await insert(tx, request);
          if (start !== undefined) inserted.push(start);
        }
        return inserted;
      }),
    request: (version) =>
      db().transaction(async (tx) => {
        const { now, starts, reports } = await ledger(tx);
        const decision = requestedStart(grouped(starts)(version), reports, now);
        if (decision.outcome === 'live') return { start: decision.start, began: false };
        const start = await insert(tx, version);
        if (start === undefined) throw new Error('The start was not recorded');
        return { start, began: true };
      }),
    recent: async () =>
      (
        await db().select(startColumns).from(checkStart).where(gte(checkStart.startedAt, since))
      ).map((row) => ({ ...row, startedAt: row.startedAt.getTime() })),
  };
}
