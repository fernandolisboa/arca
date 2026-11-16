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
 * The one-time import of the repository's rules (ADR-0031), on the real migrations: it ran with
 * them, running it again changes nothing, and a stored row with another hash aborts it.
 */
let database: string;
let importSql: string;
beforeAll(async () => {
  database = await freshDatabase();
  const migrations = await realMigrations();
  await migrate(migratorTarget(database), migrations, await containerPolicy());
  const found = migrations.find(({ name }) => name.endsWith('_knowledge_rule_import'));
  if (found === undefined) throw new Error('No import migration');
  importSql = found.sql;
});
afterAll(async () => {
  await dropDatabase(database);
});

const counts = () =>
  withClient(adminTarget(database), async (client) => {
    const { rows } = await client.query<{ routes: string; sets: string; lists: string }>(
      `SELECT (SELECT count(*) FROM knowledge.route_version) AS routes,
              (SELECT count(*) FROM knowledge.country_set) AS sets,
              (SELECT count(*) FROM knowledge.official_domain_list) AS lists`,
    );
    return rows[0];
  });

/** Runs the import as the migrator does, in one transaction that is always rolled back. */
const runImport = () =>
  withClient(migratorTarget(database), async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(importSql);
    } finally {
      await client.query('ROLLBACK');
    }
  });

describe('the rule import (ADR-0031)', () => {
  it('stored every route version, country set and official-domain list with the migrations', async () => {
    const stored = await counts();
    expect(Number(stored?.routes)).toBeGreaterThan(0);
    expect(Number(stored?.sets)).toBeGreaterThan(0);
    expect(Number(stored?.lists)).toBeGreaterThan(0);
  });

  it('changes nothing when it runs again', async () => {
    const before = await counts();
    await withClient(migratorTarget(database), (client) => client.query(importSql));
    expect(await counts()).toEqual(before);
  });

  it('aborts when a stored row has another hash', async () => {
    await withClient(adminTarget(database), (client) =>
      client.query(`
        ALTER TABLE knowledge.route_version DISABLE ROW LEVEL SECURITY;
        UPDATE knowledge.route_version SET content_hash = repeat('0', 64)
          WHERE (route_id, number) = (SELECT route_id, number FROM knowledge.route_version LIMIT 1);
        ALTER TABLE knowledge.route_version ENABLE ROW LEVEL SECURITY;`),
    );
    await expect(runImport()).rejects.toThrow(/a stored route version has another content hash/);
  });
});
