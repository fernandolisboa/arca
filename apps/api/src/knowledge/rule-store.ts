import { createHash } from 'node:crypto';
import type { Database } from '@arca/db';
import { countrySet, officialDomainList, routeVersion } from '@arca/db/knowledge-schema';
import {
  type Json,
  type RuleData,
  type RuleEngineData,
  type RuleRowReading,
  type RuleRows,
  countryFiles,
  refusedRows,
  ruleDataFromRows,
  ruleEngineData,
} from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import { sql } from 'drizzle-orm';
import { hostOf } from './host.js';

/** The rules the database holds (ADR-0031), as the engine and the activation screen read them. */
export interface RuleStore {
  /** Every version, set and list whose content still hashes to its stored hash. */
  readonly data: () => Promise<RuleData>;
  /**
   * The engine's catalog over them, with full entries only for active versions (spec 0002, R5),
   * and every route it has a version of, in a stable order.
   */
  readonly engine: () => Promise<RuleEngineData>;
  /** The rows as stored, which a proposal is hashed and checked against (ADR-0031). */
  readonly rows: () => Promise<RuleRows>;
  /** How the rows are read: the countries files, the hashing and the host parser. */
  readonly reading: RuleRowReading;
}

export type { RuleEngineData };

/** A hex SHA-256 of a text's UTF-8. */
export const sha256 = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Reads the rule rows on the given pool. Rows are insert-only, so the row counts tell whether
 * anything was added: the rows are read and their hashes recomputed again only then. A change made
 * in place behind the grants keeps the counts, so a running instance keeps the content it already
 * verified, and the next cold start refuses the changed row. A refused row's route is left out
 * whole and logged, never evaluated.
 */
export function postgresRuleStore(db: () => Database, logger: Logger): RuleStore {
  let cached: { counts: string; rows: Promise<RuleRows> } | undefined;
  const reading: RuleRowReading = { countryFiles, sha256, hostOf };
  const parsed = new WeakMap<RuleRows, RuleData>();

  const readRows = async (): Promise<RuleRows> => {
    const rows = await db().transaction(
      async (tx) => ({
        routeVersions: await tx
          .select({
            routeId: routeVersion.routeId,
            number: routeVersion.number,
            content: routeVersion.content,
            contentHash: routeVersion.contentHash,
            cases: routeVersion.cases,
          })
          .from(routeVersion),
        countrySets: await tx
          .select({
            id: countrySet.setId,
            number: countrySet.number,
            content: countrySet.content,
            contentHash: countrySet.contentHash,
          })
          .from(countrySet),
        officialDomainLists: await tx
          .select({
            id: officialDomainList.listId,
            number: officialDomainList.number,
            content: officialDomainList.content,
            contentHash: officialDomainList.contentHash,
            requestId: officialDomainList.requestId,
          })
          .from(officialDomainList),
      }),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
    return {
      routeVersions: rows.routeVersions.map((row) => ({
        ...row,
        content: row.content as Json,
        cases: row.cases as Json | null,
      })),
      countrySets: rows.countrySets.map((row) => ({ ...row, content: row.content as Json })),
      officialDomainLists: rows.officialDomainLists.map((row) => ({
        ...row,
        content: row.content as Json,
      })),
    };
  };

  /** The rows read once for each change in the counts. */
  const currentRows = async (): Promise<RuleRows> => {
    const result = await db().execute<{ counts: string }>(sql`
      SELECT concat_ws('/',
        (SELECT count(*) FROM knowledge.route_version),
        (SELECT count(*) FROM knowledge.country_set),
        (SELECT count(*) FROM knowledge.official_domain_list)) AS counts`);
    const counts = result.rows[0]?.counts ?? '';
    if (cached?.counts !== counts) {
      const pending = readRows();
      cached = { counts, rows: pending };
      // A failed read is not kept, so the next request reads again.
      pending.catch(() => {
        if (cached?.rows === pending) cached = undefined;
      });
    }
    return cached.rows;
  };

  const data = async (): Promise<RuleData> => {
    const rows = await currentRows();
    let read = parsed.get(rows);
    if (read === undefined) {
      read = ruleDataFromRows(rows, reading);
      if (refusedRows(read).length > 0) logger.error({ errorName: 'KnowledgeRowRefused' });
      parsed.set(rows, read);
    }
    return read;
  };

  const engine = async (): Promise<RuleEngineData> => ruleEngineData(await data());

  return { data, engine, rows: currentRows, reading };
}
