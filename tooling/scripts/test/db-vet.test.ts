import { describe, expect, it } from 'vitest';
import { vetMigration } from '../src/db/vet.ts';

async function problems(sql: string, extensions: string[] = []) {
  return (await vetMigration(sql, extensions)).problems;
}

describe('vetMigration', () => {
  it('splits statements as the parser does, multi-byte text and dollar quotes included', async () => {
    const sql = [
      "CREATE SCHEMA app; COMMENT ON SCHEMA app IS 'ação; ok';",
      'CREATE FUNCTION app.f() RETURNS int LANGUAGE sql AS $$ SELECT 1; $$;',
      'SELECT 1',
    ].join('\n');
    const vetted = await vetMigration(sql, []);
    expect(vetted.problems).toEqual([]);
    expect(vetted.statements).toEqual([
      'CREATE SCHEMA app',
      "COMMENT ON SCHEMA app IS 'ação; ok'",
      'CREATE FUNCTION app.f() RETURNS int LANGUAGE sql AS $$ SELECT 1; $$',
      'SELECT 1',
    ]);
  });

  it.each([
    ['BEGIN', 'controls the transaction'],
    ['START TRANSACTION', 'controls the transaction'],
    ['COMMIT', 'controls the transaction'],
    ['END', 'controls the transaction'],
    ['ROLLBACK', 'controls the transaction'],
    ['ABORT', 'controls the transaction'],
    ['SAVEPOINT s', 'controls the transaction'],
    ['RELEASE SAVEPOINT s', 'controls the transaction'],
    ["PREPARE TRANSACTION 'x'", 'controls the transaction'],
    ["COMMIT PREPARED 'x'", 'controls the transaction'],
    ['SET search_path = app', 'changes a setting or role'],
    ['SET LOCAL search_path = app', 'changes a setting or role'],
    ['RESET search_path', 'changes a setting or role'],
    ['SET ROLE app_api', 'changes a setting or role'],
    ['RESET ROLE', 'changes a setting or role'],
    ['SET SESSION AUTHORIZATION app_api', 'changes a setting or role'],
    ['CREATE ROLE intruder', 'changes roles or role settings'],
    ["ALTER ROLE app_api SET app.person_id = 'x'", 'changes roles or role settings'],
    ["ALTER DATABASE neondb SET app.person_id = 'x'", 'changes roles or role settings'],
    ['GRANT app_api TO app_jobs', 'changes roles or role settings'],
    ["ALTER ROLE app_api PASSWORD 'x'", 'sets a password'],
    ["CREATE USER intruder PASSWORD 'x'", 'sets a password'],
    ['CREATE INDEX CONCURRENTLY i ON app.t (id)', 'uses CONCURRENTLY'],
    ['DROP INDEX CONCURRENTLY app.i', 'uses CONCURRENTLY'],
    ['REINDEX (CONCURRENTLY) TABLE app.t', 'uses CONCURRENTLY'],
    ['REFRESH MATERIALIZED VIEW CONCURRENTLY app.m', 'uses CONCURRENTLY'],
    ['CREATE TEMP VIEW pg_class AS SELECT 1', 'creates a temporary object'],
    ['CREATE TEMPORARY TABLE t (id int)', 'creates a temporary object'],
    ['CREATE EXTENSION dblink', 'creates extension dblink, which is not allowed'],
    ['DECLARE c CURSOR WITH HOLD FOR SELECT 1', 'declares a cursor'],
  ])('rejects %s', async (sql, problem) => {
    expect((await problems(`CREATE SCHEMA a; ${sql};`)).join('\n')).toContain(
      `statement 2 ${problem}`,
    );
  });

  it('allows an allow-listed extension', async () => {
    expect(await problems('CREATE EXTENSION pgcrypto', ['pgcrypto'])).toEqual([]);
  });

  it('rejects an empty migration', async () => {
    expect(await problems('-- nothing\n')).toEqual(['has no statements']);
  });

  it('throws on SQL the parser cannot read', async () => {
    await expect(vetMigration('CREATE SCHEMA', [])).rejects.toThrow();
  });

  it('cannot see inside dynamic SQL, which the transaction checks cover', async () => {
    expect(await problems("DO $$ BEGIN EXECUTE 'COMMIT'; END $$")).toEqual([]);
  });
});
