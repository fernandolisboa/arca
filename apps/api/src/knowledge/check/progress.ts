import {
  type CheckProgressEvent,
  checkStatuses,
  maxCheckItemKeyLength,
  pageProgressOutcomes,
  progressFailures,
} from '@arca/domain';
import type { Database } from '@arca/db';
import { checkProgress } from '@arca/db/knowledge-schema';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

/**
 * What a running check recorded, across instances (ADR-0027, "On demand, with progress"): written
 * by the check's step, read by the API for the progress screen.
 */
export interface CheckProgressStore {
  /** Appends one event of a start; `sequence` orders the start's events from zero. */
  readonly record: (startId: string, sequence: number, event: CheckProgressEvent) => Promise<void>;
  /**
   * A start's events in the order recorded; a row the closed schema refuses is left out, except a
   * usage, which reads as `unreadableUsage`.
   */
  readonly list: (startId: string) => Promise<readonly CheckProgressEvent[]>;
}

/**
 * The most events one start records: two per cited page, one per model call, a handful of stages,
 * and at most one item event per item for each of the two model calls a check may take.
 */
export const maxProgressEvents = 1_000;

const count = z.int().min(0).max(1_000);
const tokens = z.int().min(0).max(100_000_000).nullable();
const storedEvent = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('started'), items: count, pages: count }),
  z.strictObject({
    kind: z.literal('page'),
    url: z.string().max(2_000),
    outcome: z.enum(pageProgressOutcomes),
    // Rows written before the status was recorded have none.
    status: z.int().min(0).max(999).nullable().default(null),
  }),
  z.strictObject({ kind: z.literal('locating'), pages: count }),
  z.strictObject({ kind: z.literal('comparing') }),
  z.strictObject({
    kind: z.literal('item'),
    key: z.string().max(maxCheckItemKeyLength),
    status: z.enum(checkStatuses),
  }),
  z.strictObject({
    kind: z.literal('usage'),
    model: z.string().regex(/^[a-z0-9.-]{1,100}$/u),
    inputTokens: tokens,
    outputTokens: tokens,
    cacheReadTokens: tokens,
    cacheWriteTokens: tokens,
  }),
  z.strictObject({ kind: z.literal('finished') }),
  z.strictObject({ kind: z.literal('failed'), code: z.enum(progressFailures) }),
]) satisfies z.ZodType<CheckProgressEvent>;

/** A stored usage the schema refuses: no price matches its model, so the cost is unknown. */
export const unreadableUsage: CheckProgressEvent = {
  kind: 'usage',
  model: 'unreadable',
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
};

/** For tests: kept while the process runs. */
export function memoryCheckProgressStore(): CheckProgressStore & {
  readonly rows: { startId: string; sequence: number; event: CheckProgressEvent }[];
} {
  const rows: { startId: string; sequence: number; event: CheckProgressEvent }[] = [];
  return {
    rows,
    record: (startId, sequence, event) => {
      if (rows.some((row) => row.startId === startId && row.sequence === sequence)) {
        return Promise.reject(new Error('A start records each sequence number once'));
      }
      rows.push({ startId, sequence, event });
      return Promise.resolve();
    },
    list: (startId) =>
      Promise.resolve(
        rows
          .filter((row) => row.startId === startId)
          .sort((left, right) => left.sequence - right.sequence)
          .map(({ event }) => event),
      ),
  };
}

/**
 * `knowledge.check_progress`: the step inserts on the app_jobs pool, the API reads on the app_api
 * pool. Each row is parsed against the closed event schema on the way out, so a row the table's
 * checks let through never reaches the screen in another shape.
 */
export function postgresCheckProgressStore(db: () => Database): CheckProgressStore {
  return {
    async record(startId, sequence, { kind, ...detail }) {
      // Raw SQL: the role may insert every column but the time, which a builder insert would
      // name with DEFAULT.
      await db().execute(sql`
        INSERT INTO knowledge.check_progress (start_id, sequence, kind, detail)
        VALUES (${startId}, ${sequence}, ${kind}, ${JSON.stringify(detail)}::jsonb)`);
    },
    async list(startId) {
      const rows = await db()
        .select({ kind: checkProgress.kind, detail: checkProgress.detail })
        .from(checkProgress)
        .where(eq(checkProgress.startId, startId))
        .orderBy(asc(checkProgress.sequence))
        .limit(maxProgressEvents);
      return rows.flatMap(({ kind, detail }) => {
        const parsed = storedEvent.safeParse({
          ...(typeof detail === 'object' && detail !== null ? detail : {}),
          kind,
        });
        if (parsed.success) return [parsed.data];
        // A model call's usage the schema refuses still happened, so the check's cost reads as
        // unknown rather than short by that call.
        return kind === 'usage' ? [unreadableUsage] : [];
      });
    },
  };
}
