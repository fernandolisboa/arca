import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigrationRejected, migrate } from '../../src/db/runner.ts';
import { runGuards } from '../../src/db/guards.ts';
import {
  adminTarget,
  containerPolicy,
  dropDatabase,
  freshDatabase,
  migration,
  migratorTarget,
  realMigrations,
  withClient,
} from './support.ts';

let database: string;
beforeEach(async () => {
  database = await freshDatabase();
});
afterEach(async () => {
  await dropDatabase(database);
});

async function journal(): Promise<string[]> {
  return withClient(adminTarget(database), async (client) => {
    const result = await client.query<{ name: string }>(
      `SELECT name FROM arca_migrations.journal ORDER BY name`,
    );
    return result.rows.map((row) => row.name);
  });
}

async function schemaExists(name: string): Promise<boolean> {
  return withClient(adminTarget(database), async (client) => {
    const result = await client.query('SELECT FROM pg_catalog.pg_namespace WHERE nspname = $1', [
      name,
    ]);
    return result.rowCount === 1;
  });
}

async function roleState(): Promise<unknown[]> {
  return withClient(adminTarget(database), async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `SELECT r.rolname, a.rolpassword, s.setconfig
         FROM pg_catalog.pg_roles r
         JOIN pg_catalog.pg_authid a ON a.oid = r.oid
         LEFT JOIN pg_catalog.pg_db_role_setting s ON s.setrole = r.oid
        WHERE r.rolname LIKE 'app\\_%' ORDER BY 1`,
    );
    return result.rows;
  });
}

describe('migrate', () => {
  it('applies the real migrations once, with every guard passing', async () => {
    const files = await realMigrations();
    const policy = await containerPolicy();
    const first = await migrate(migratorTarget(database), files, policy);
    expect(first.applied).toEqual(files.map((file) => file.name));
    expect(await journal()).toEqual(files.map((file) => file.name));
    expect((await migrate(migratorTarget(database), files, policy)).applied).toEqual([]);
    await withClient(adminTarget(database), async (client) => {
      expect(await runGuards(client, policy)).toEqual([]);
      const owner = await client.query<{ owner: string }>(
        `SELECT pg_catalog.pg_get_userbyid(nspowner) AS owner FROM pg_catalog.pg_namespace WHERE nspname = 'app'`,
      );
      expect(owner.rows).toEqual([{ owner: 'app_migrator' }]);
    });
  });

  it('refuses to connect as anything but app_migrator', async () => {
    await expect(
      migrate(adminTarget(database), await realMigrations(), await containerPolicy()),
    ).rejects.toThrow('the runner connects as app_migrator');
  });

  it('applies a migration once when two runs race', async () => {
    const files = [
      ...(await realMigrations()),
      migration('20990101000000_slow', 'SELECT pg_catalog.pg_sleep(0.5)'),
    ];
    const policy = await containerPolicy();
    const runs = await Promise.all([
      migrate(migratorTarget(database), files, policy),
      migrate(migratorTarget(database), files, policy),
    ]);
    expect(runs.map((run) => run.applied.length).sort()).toEqual([0, files.length]);
    expect(await journal()).toEqual(files.map((file) => file.name));
  });

  it('refuses a journal that a migration did not earn', async () => {
    const files = await realMigrations();
    const policy = await containerPolicy();
    await migrate(migratorTarget(database), files, policy);
    const changed = files.map((file, index) =>
      index === 0 ? migration(file.name, `${file.sql}\n-- edited`) : file,
    );
    await expect(migrate(migratorTarget(database), changed, policy)).rejects.toThrow(
      'changed after it was applied',
    );
  });

  // Spec 0001, R7: each canary must fail and leave nothing committed, in plain and DO-block form.
  const canaries: [string, string, string][] = [
    ['an embedded COMMIT', 'COMMIT', 'controls the transaction'],
    [
      'an embedded COMMIT in a DO block',
      'DO $$ BEGIN COMMIT; END $$',
      'invalid transaction termination',
    ],
    [
      'a shadowing temporary view',
      'CREATE TEMP VIEW pg_roles AS SELECT * FROM pg_catalog.pg_roles WHERE false',
      'creates a temporary object',
    ],
    [
      'a shadowing temporary view in a DO block',
      `DO $$ BEGIN EXECUTE 'CREATE TEMP VIEW pg_roles AS SELECT * FROM pg_catalog.pg_roles WHERE false'; END $$`,
      'created temporary object pg_roles',
    ],
    [
      'a role default',
      "ALTER ROLE app_migrator SET app.person_id = '00000000-0000-4000-8000-000000000000'",
      'changes roles or role settings',
    ],
    [
      'a role default in a DO block',
      `DO $$ BEGIN EXECUTE 'ALTER ROLE app_migrator SET search_path = pg_temp, public'; END $$`,
      'changed roles (wrote pg_db_role_setting)',
    ],
    ['a role switch', 'SET ROLE app_api', 'changes a setting or role'],
    [
      'a role switch in a DO block',
      `DO $$ BEGIN PERFORM pg_catalog.set_config('role', 'app_api', false); END $$`,
      'permission denied to set role',
    ],
    ['a password change', "ALTER ROLE app_migrator PASSWORD 'x'", 'sets a password'],
    [
      'a password change in a DO block',
      `DO $$ BEGIN EXECUTE 'ALTER ROLE app_migrator PASSWORD ''changed-by-a-migration'''; END $$`,
      'changed roles (wrote pg_authid)',
    ],
    [
      'a search path set for the session',
      `SELECT pg_catalog.set_config('search_path', 'pg_temp, pg_catalog', false)`,
      '',
    ],
    [
      'a journal row for a later file',
      "INSERT INTO arca_migrations.journal (name, checksum) VALUES ('20990101000000_later', 'x')",
      'the journal does not equal its state before the run',
    ],
    [
      'a journal row for a later file in a DO block',
      `DO $$ BEGIN EXECUTE 'INSERT INTO arca_migrations.journal (name, checksum) VALUES (''20990101000000_later'', ''x'')'; END $$`,
      'the journal does not equal its state before the run',
    ],
    [
      'a trigger on the journal',
      `CREATE FUNCTION app.noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
       CREATE TRIGGER t BEFORE INSERT ON arca_migrations.journal FOR EACH ROW EXECUTE FUNCTION app.noop()`,
      'the journal table has a trigger',
    ],
    [
      'a table without row-level security',
      'CREATE TABLE app.cases (id uuid PRIMARY KEY)',
      'guard 1: table app.cases does not have row-level security enabled and forced',
    ],
  ];

  it.each(canaries)('rejects %s and commits nothing', async (_name, sql, problem) => {
    const files = await realMigrations();
    const policy = await containerPolicy();
    await migrate(migratorTarget(database), files, policy);
    const before = await roleState();
    const canary = migration('20990101000000_canary', `CREATE SCHEMA canary;\n${sql};`);
    const run = migrate(migratorTarget(database), [...files, canary], policy);
    if (problem === '') {
      // Harmless once the runner pins its own search path: it must apply and pass the guards.
      await expect(run).resolves.toEqual({ applied: [canary.name] });
      return;
    }
    await expect(run).rejects.toThrow(problem);
    expect(await schemaExists('canary')).toBe(false);
    expect(await journal()).toEqual(files.map((file) => file.name));
    expect(await roleState()).toEqual(before);
  });

  it('reports every vetting problem before it connects', async () => {
    const run = migrate(
      migratorTarget(database),
      [migration('20990101000000_bad', 'BEGIN; SET ROLE app_api; CREATE EXTENSION dblink;')],
      await containerPolicy(),
    );
    await expect(run).rejects.toBeInstanceOf(MigrationRejected);
    await expect(run).rejects.toThrow(
      '20990101000000_bad: statement 1 controls the transaction; 20990101000000_bad: statement 2 changes a setting or role (SET or RESET); 20990101000000_bad: statement 3 creates extension dblink, which is not allowed',
    );
  });
});
