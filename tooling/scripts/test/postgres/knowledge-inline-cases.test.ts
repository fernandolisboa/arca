import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/runner.ts';
import {
  adminTarget,
  containerPolicy,
  dropDatabase,
  freshDatabase,
  migratorTarget,
  realMigrations,
  withClient,
} from './support.ts';

/**
 * The rewrite of imported cases that pinned a synthetic family (ADR-0031), on the real
 * migrations: no row pins a family, only the cases changed, and the migrator keeps no way to
 * update a rule row.
 */
let database: string;
let rewriteSql: string;
beforeAll(async () => {
  database = await freshDatabase();
  const migrations = await realMigrations();
  await migrate(migratorTarget(database), migrations, await containerPolicy());
  const found = migrations.find(({ name }) => name.endsWith('_knowledge_inline_rule_cases'));
  if (found === undefined) throw new Error('No inline cases migration');
  rewriteSql = found.sql;
});
afterAll(async () => {
  await dropDatabase(database);
});

const snapshot = () =>
  withClient(adminTarget(database), async (client) => {
    const { rows } = await client.query<{ key: string; hash: string; cases: string }>(
      `SELECT route_id || '/' || number AS key, content_hash AS hash, md5(cases::text) AS cases
         FROM knowledge.route_version ORDER BY route_id, number`,
    );
    return rows;
  });

describe('the inline cases rewrite (ADR-0031)', () => {
  it('leaves no route version pinning a family, EB-5 included, with inline snapshots', async () => {
    const stored = await withClient(adminTarget(database), async (client) => {
      const { rows } = await client.query<{ pinning: string; eb5: string }>(
        `SELECT (SELECT count(*) FROM knowledge.route_version
                  WHERE jsonb_path_exists(cases, '$.cases[*].family')) AS pinning,
                (SELECT count(*) FROM knowledge.route_version
                  WHERE route_id = 'us-eb5'
                    AND jsonb_path_exists(cases, '$.cases[*].snapshot')) AS eb5`,
      );
      return rows[0];
    });
    expect(Number(stored?.pinning)).toBe(0);
    expect(Number(stored?.eb5)).toBeGreaterThan(0);
  });

  it('leaves the migrator no update privilege or policy on route versions', async () => {
    const granted = await withClient(adminTarget(database), async (client) => {
      const { rows } = await client.query<{ update: boolean; policies: string }>(
        `SELECT has_any_column_privilege('app_migrator', 'knowledge.route_version', 'UPDATE')
                  AS update,
                (SELECT count(*) FROM pg_policies WHERE schemaname = 'knowledge'
                  AND tablename = 'route_version' AND cmd = 'UPDATE') AS policies`,
      );
      return rows[0];
    });
    expect(granted?.update).toBe(false);
    expect(Number(granted?.policies)).toBe(0);
  });

  it('changes nothing when it runs again', async () => {
    const before = await snapshot();
    await withClient(migratorTarget(database), (client) => client.query(rewriteSql));
    expect(await snapshot()).toEqual(before);
  });
});
