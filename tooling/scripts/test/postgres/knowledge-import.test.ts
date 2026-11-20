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
let reviewSqls: string[];
beforeAll(async () => {
  database = await freshDatabase();
  const migrations = await realMigrations();
  await migrate(migratorTarget(database), migrations, await containerPolicy());
  const found = migrations.find(({ name }) => name.endsWith('_knowledge_rule_import'));
  if (found === undefined) throw new Error('No import migration');
  importSql = found.sql;
  reviewSqls = migrations
    .filter(({ name }) => /_knowledge_session_review_\d{4}_/u.test(name))
    .map(({ sql }) => sql);
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

/** Runs a migration as the migrator does, in one transaction that is always rolled back. */
const run = (sql: string) =>
  withClient(migratorTarget(database), async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(sql);
    } finally {
      await client.query('ROLLBACK');
    }
  });
const runImport = () => run(importSql);

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

  it.each([
    ['route_version', 'route_id', 'route version'],
    ['country_set', 'set_id', 'country set'],
    ['official_domain_list', 'list_id', 'official-domain list'],
  ])('aborts when a stored %s row has another hash', async (table, idColumn, what) => {
    await withClient(adminTarget(database), (client) =>
      client.query(`
        ALTER TABLE knowledge.${table} DISABLE ROW LEVEL SECURITY;
        UPDATE knowledge.${table} SET content_hash = repeat('0', 64)
          WHERE (${idColumn}, number) = (SELECT ${idColumn}, number FROM knowledge.${table} LIMIT 1);
        ALTER TABLE knowledge.${table} ENABLE ROW LEVEL SECURITY;`),
    );
    await expect(runImport()).rejects.toThrow(`a stored ${what} has another content hash`);
  });
});

describe("a session review's migration (ADR-0032)", () => {
  it('fails when the database already holds a version under its ID and number', async () => {
    expect(reviewSqls.length).toBeGreaterThan(0);
    for (const sql of reviewSqls) {
      await expect(run(sql)).rejects.toThrow(/duplicate key value violates unique constraint/u);
    }
  });
});
