import { createHash } from 'node:crypto';
import type { Database } from '@arca/db';
import { countrySet, officialDomainList, routeVersion } from '@arca/db/knowledge-schema';
import type { RouteCatalog } from '@arca/domain';
import {
  type Json,
  type RuleData,
  countryFiles,
  createRouteCatalog,
  ruleDataFromRows,
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
}

export interface RuleEngineData {
  readonly catalog: RouteCatalog;
  readonly routeIds: readonly string[];
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Reads the rule rows on the given pool. Rows are insert-only, so the row counts tell whether
 * anything was added: the rows are read and their hashes recomputed again only then, and a row that
 * does not hash to its stored hash is left out and logged, never evaluated.
 */
export function postgresRuleStore(db: () => Database, logger: Logger): RuleStore {
  let cached: { counts: string; data: Promise<RuleData> } | undefined;
  const derived = new WeakMap<RuleData, RuleEngineData>();

  const read = async (): Promise<RuleData> => {
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
          })
          .from(officialDomainList),
      }),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
    const data = ruleDataFromRows(
      {
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
      },
      { countryFiles, sha256, hostOf },
    );
    if (data.refused.length > 0) logger.error({ errorName: 'KnowledgeRowRefused' });
    return data;
  };

  const data = async (): Promise<RuleData> => {
    const result = await db().execute<{ counts: string }>(sql`
      SELECT concat_ws('/',
        (SELECT count(*) FROM knowledge.route_version),
        (SELECT count(*) FROM knowledge.country_set),
        (SELECT count(*) FROM knowledge.official_domain_list)) AS counts`);
    const counts = result.rows[0]?.counts ?? '';
    if (cached?.counts !== counts) {
      const reading = read();
      cached = { counts, data: reading };
      // A failed read is not kept, so the next request reads again.
      reading.catch(() => {
        if (cached?.data === reading) cached = undefined;
      });
    }
    return cached.data;
  };

  const engine = async (): Promise<RuleEngineData> => {
    const current = await data();
    let known = derived.get(current);
    if (known === undefined) {
      known = {
        catalog: createRouteCatalog(current.entries),
        routeIds: [
          ...new Set([...current.entries.values()].map(({ identity }) => identity.routeId)),
        ].sort(),
      };
      derived.set(current, known);
    }
    return known;
  };

  return { data, engine };
}
