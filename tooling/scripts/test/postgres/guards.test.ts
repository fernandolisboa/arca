import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGuards } from '../../src/db/guards.ts';
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

let database: string;
beforeAll(async () => {
  database = await freshDatabase();
  await migrate(migratorTarget(database), await realMigrations(), await containerPolicy());
});
afterAll(async () => {
  await dropDatabase(database);
});

// Each fixture breaks one guard inside a transaction that is rolled back, so the cluster-wide role
// changes never outlive the test.
const fixtures: [number, string, string][] = [
  [1, 'CREATE TABLE app.cases (id uuid)', 'table app.cases does not have row-level security'],
  [
    1,
    'CREATE TABLE app.cases (id uuid); ALTER TABLE app.cases ENABLE ROW LEVEL SECURITY',
    'table app.cases does not have row-level security enabled and forced',
  ],
  [2, 'CREATE VIEW app.v AS SELECT 1 AS one', 'view app.v does not set security_invoker = true'],
  [
    2,
    'CREATE VIEW app.v WITH (security_invoker = off) AS SELECT 1 AS one',
    'view app.v does not set security_invoker = true',
  ],
  [
    2,
    'CREATE MATERIALIZED VIEW app.m AS SELECT 1 AS one',
    'materialized view app.m is not allow-listed',
  ],
  [
    2,
    'CREATE FUNCTION app.f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$',
    'function app.f is SECURITY DEFINER and not allow-listed',
  ],
  [3, 'CREATE ROLE stray LOGIN', 'role stray can log in but is not an app role'],
  [3, 'ALTER ROLE app_audit NOLOGIN', 'app role app_audit is missing or cannot log in'],
  [4, 'ALTER ROLE app_api BYPASSRLS', 'role app_api has BYPASSRLS'],
  [4, 'ALTER ROLE app_jobs CREATEDB', 'role app_jobs has CREATEDB'],
  [4, 'ALTER ROLE app_migrator CREATEROLE', 'role app_migrator has CREATEROLE'],
  [4, 'CREATE ROLE stray NOLOGIN SUPERUSER', 'role stray has SUPERUSER'],
  [5, 'GRANT app_api TO app_jobs', 'app_jobs is a member of app_api'],
  [5, 'GRANT pg_read_all_data TO app_api', 'app_api is a member of pg_read_all_data'],
  [
    5,
    'CREATE ROLE stray NOLOGIN; GRANT stray TO app_api; GRANT pg_read_all_data TO stray',
    'app_api is a member of stray',
  ],
  [6, 'GRANT CREATE ON SCHEMA app TO app_api', 'app_api has CREATE on schema app'],
  [6, 'ALTER SCHEMA app OWNER TO app_jobs', 'app_jobs owns schema app'],
  [6, 'CREATE TABLE app.t (id int); ALTER TABLE app.t OWNER TO app_auth', 'app_auth owns app.t'],
  [
    6,
    `DO $$ BEGIN EXECUTE pg_catalog.format('GRANT CREATE ON DATABASE %I TO app_audit', pg_catalog.current_database()); END $$`,
    'app_audit has CREATE on the database',
  ],
  [
    7,
    "ALTER ROLE app_api SET app.account_id = '00000000-0000-4000-8000-000000000000'",
    'role default */app_api/app.account_id=00000000-0000-4000-8000-000000000000 is not allow-listed',
  ],
  [8, 'CREATE EXTENSION pgcrypto', 'extension pgcrypto is not allow-listed'],
  [
    9,
    'CREATE TABLE app.a (id int PRIMARY KEY); CREATE TABLE app.b (a int REFERENCES app.a DEFERRABLE)',
    'constraint b_a_fkey on app.b is deferrable and not allow-listed',
  ],
  [8, 'DROP EXTENSION plpgsql', 'extension plpgsql is expected but not installed'],
];

describe('guards', () => {
  it('pass on the migrated database', async () => {
    const policy = await containerPolicy();
    await withClient(adminTarget(database), async (client) => {
      expect(await runGuards(client, policy)).toEqual([]);
    });
  });

  it('accept any spelling of security_invoker on', async () => {
    const policy = await containerPolicy();
    await withClient(adminTarget(database), async (client) => {
      await client.query('BEGIN');
      try {
        for (const [index, value] of ['true', 'on', '1', 'yes'].entries()) {
          await client.query(
            `CREATE VIEW app.v${String(index)} WITH (security_invoker = ${value}) AS SELECT 1 AS one`,
          );
        }
        expect(await runGuards(client, policy)).toEqual([]);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it.each(fixtures)('guard %i fails on: %s', async (guard, sql, problem) => {
    const policy = await containerPolicy();
    await withClient(adminTarget(database), async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(sql);
        const violations = await runGuards(client, policy);
        expect(violations).toContainEqual({
          guard,
          problem: expect.stringContaining(problem) as string,
        });
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });
});
