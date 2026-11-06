import type { RuleSummary } from '@arca/api-contract/routes';
import type { Database } from '@arca/db';
import { ruleSummary } from '@arca/db/knowledge-schema';
import { and, eq } from 'drizzle-orm';

/** What one stored summary answers for: a version's content, read with one prompt by one model. */
export interface SummaryKey {
  readonly contentHash: string;
  readonly promptVersion: string;
  readonly model: string;
}

/** Summaries kept across visits and server instances (ADR-0025). */
export interface RuleSummaryStore {
  readonly find: (key: SummaryKey) => Promise<RuleSummary | undefined>;
  /** Keeps the first summary stored for a key; a later one for the same key is dropped. */
  readonly save: (key: SummaryKey, summary: RuleSummary) => Promise<void>;
}

const keyOf = ({ contentHash, promptVersion, model }: SummaryKey) =>
  `${contentHash}/${promptVersion}/${model}`;

/** For tests and for a server with no database: kept while the process runs. */
export function memorySummaryStore(): RuleSummaryStore {
  const rows = new Map<string, RuleSummary>();
  return {
    find: (key) => Promise.resolve(rows.get(keyOf(key))),
    save: (key, summary) => {
      if (!rows.has(keyOf(key))) rows.set(keyOf(key), summary);
      return Promise.resolve();
    },
  };
}

/** `knowledge.rule_summary` on the app_api pool, which may only read and insert. */
export function postgresSummaryStore(db: () => Database): RuleSummaryStore {
  return {
    async find({ contentHash, promptVersion, model }) {
      const [row] = await db()
        .select({ overview: ruleSummary.overview, watchPoints: ruleSummary.watchPoints })
        .from(ruleSummary)
        .where(
          and(
            eq(ruleSummary.contentHash, contentHash),
            eq(ruleSummary.promptVersion, promptVersion),
            eq(ruleSummary.model, model),
          ),
        );
      return row;
    },
    async save(key, { overview, watchPoints }) {
      await db()
        .insert(ruleSummary)
        .values({ ...key, overview, watchPoints })
        .onConflictDoNothing();
    },
  };
}
