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
      'a COMMIT hidden from the parser by standard_conforming_strings',
      `SELECT pg_catalog.set_config('standard_conforming_strings', 'off', true);
       SELECT 'x\\' , 'y; COMMIT; SELECT 1 --'`,
      'cannot insert multiple commands into a prepared statement',
    ],
    [
      'a rule on the journal',
      'CREATE RULE r AS ON INSERT TO arca_migrations.journal DO ALSO SELECT 1',
      'the journal table has a rule',
    ],
    [
      'a policy on the journal',
      'CREATE POLICY p ON arca_migrations.journal USING (true)',
      'the journal table has a policy',
    ],
    [
      'row-level security on the journal',
      'ALTER TABLE arca_migrations.journal ENABLE ROW LEVEL SECURITY',
      'the journal is not a plain table without row-level security',
    ],
    [
      'a journal default that unpins the search path for the guards',
      `CREATE FUNCTION app.always(text, text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
       CREATE OPERATOR app.= (LEFTARG = text, RIGHTARG = text, FUNCTION = app.always);
       CREATE FUNCTION app.hijack() RETURNS boolean LANGUAGE plpgsql AS $$
         BEGIN PERFORM pg_catalog.set_config('search_path', 'app, pg_catalog', true); RETURN true; END $$;
       CREATE FUNCTION app.hijack_at() RETURNS timestamptz LANGUAGE plpgsql AS $$
         BEGIN PERFORM app.hijack(); RETURN pg_catalog.now(); END $$;
       CREATE FUNCTION app.hijack_name(text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
         BEGIN PERFORM app.hijack(); RETURN $1; END $$;
       CREATE TABLE app.cases (id uuid PRIMARY KEY);
       ALTER TABLE arca_migrations.journal ALTER COLUMN applied_at SET DEFAULT app.hijack_at()`,
      'guard 1: table app.cases does not have row-level security enabled and forced',
    ],
    [
      'a journal check constraint that unpins the search path',
      `CREATE FUNCTION app.always(text, text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
       CREATE OPERATOR app.= (LEFTARG = text, RIGHTARG = text, FUNCTION = app.always);
       CREATE FUNCTION app.hijack() RETURNS boolean LANGUAGE plpgsql AS $$
         BEGIN PERFORM pg_catalog.set_config('search_path', 'app, pg_catalog', true); RETURN true; END $$;
       CREATE FUNCTION app.hijack_at() RETURNS timestamptz LANGUAGE plpgsql AS $$
         BEGIN PERFORM app.hijack(); RETURN pg_catalog.now(); END $$;
       CREATE FUNCTION app.hijack_name(text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
         BEGIN PERFORM app.hijack(); RETURN $1; END $$;
       CREATE TABLE app.cases (id uuid PRIMARY KEY);
       ALTER TABLE arca_migrations.journal ADD CONSTRAINT c CHECK (app.hijack())`,
      'the journal table has an unexpected constraint',
    ],
    [
      'a journal index expression that unpins the search path',
      `CREATE FUNCTION app.always(text, text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
       CREATE OPERATOR app.= (LEFTARG = text, RIGHTARG = text, FUNCTION = app.always);
       CREATE FUNCTION app.hijack() RETURNS boolean LANGUAGE plpgsql AS $$
         BEGIN PERFORM pg_catalog.set_config('search_path', 'app, pg_catalog', true); RETURN true; END $$;
       CREATE FUNCTION app.hijack_at() RETURNS timestamptz LANGUAGE plpgsql AS $$
         BEGIN PERFORM app.hijack(); RETURN pg_catalog.now(); END $$;
       CREATE FUNCTION app.hijack_name(text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
         BEGIN PERFORM app.hijack(); RETURN $1; END $$;
       CREATE TABLE app.cases (id uuid PRIMARY KEY);
       CREATE INDEX i ON arca_migrations.journal (app.hijack_name(name))`,
      'the journal table has an index other than its plain primary key',
    ],
    [
      'a deferred trigger that creates a table at COMMIT, after the guards',
      `CREATE TABLE app.queue (id int);
       ALTER TABLE app.queue ENABLE ROW LEVEL SECURITY;
       ALTER TABLE app.queue FORCE ROW LEVEL SECURITY;
       CREATE POLICY open ON app.queue USING (true) WITH CHECK (true);
       CREATE FUNCTION app.late() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN EXECUTE 'CREATE TABLE app.leak (id int)'; RETURN NULL; END $$;
       CREATE CONSTRAINT TRIGGER late AFTER INSERT ON app.queue
         DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.late();
       INSERT INTO app.queue VALUES (1)`,
      'guard 9: constraint late on app.queue is deferrable and not allow-listed',
    ],
    [
      'a WITH HOLD cursor, which would run at COMMIT',
      `CREATE TABLE app.cases (id uuid PRIMARY KEY);
       ALTER TABLE app.cases ENABLE ROW LEVEL SECURITY;
       ALTER TABLE app.cases FORCE ROW LEVEL SECURITY;
       CREATE FUNCTION app.at_commit() RETURNS int LANGUAGE plpgsql AS $$
         BEGIN EXECUTE 'ALTER TABLE app.cases DISABLE ROW LEVEL SECURITY'; RETURN 1; END $$;
       DECLARE hold_cursor CURSOR WITH HOLD FOR SELECT app.at_commit()`,
      'declares a cursor',
    ],
    [
      'a WITH HOLD cursor declared in a DO block',
      `CREATE TABLE app.cases (id uuid PRIMARY KEY);
       ALTER TABLE app.cases ENABLE ROW LEVEL SECURITY;
       ALTER TABLE app.cases FORCE ROW LEVEL SECURITY;
       CREATE FUNCTION app.at_commit() RETURNS int LANGUAGE plpgsql AS $$
         BEGIN EXECUTE 'ALTER TABLE app.cases DISABLE ROW LEVEL SECURITY'; RETURN 1; END $$;
       DO $d$ BEGIN EXECUTE $q$DECLARE hold_cursor CURSOR WITH HOLD FOR SELECT app.at_commit()$q$; END $d$`,
      'left cursor hold_cursor open',
    ],
    [
      'a deferrable constraint trigger',
      `CREATE TABLE app.ticks (id int, n int);
       ALTER TABLE app.ticks ENABLE ROW LEVEL SECURITY;
       ALTER TABLE app.ticks FORCE ROW LEVEL SECURITY;
       CREATE POLICY open ON app.ticks USING (true) WITH CHECK (true);
       CREATE FUNCTION app.noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
       CREATE CONSTRAINT TRIGGER t AFTER INSERT ON app.ticks
         DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION app.noop()`,
      'guard 9: constraint t on app.ticks is deferrable and not allow-listed',
    ],
    [
      'a deferrable exclusion constraint whose recheck runs code',
      `CREATE TABLE app.ticks (id int, n int);
       ALTER TABLE app.ticks ENABLE ROW LEVEL SECURITY;
       ALTER TABLE app.ticks FORCE ROW LEVEL SECURITY;
       CREATE POLICY open ON app.ticks USING (true) WITH CHECK (true);
       CREATE FUNCTION app.k(n int) RETURNS int LANGUAGE sql IMMUTABLE AS 'SELECT n';
       ALTER TABLE app.ticks ADD CONSTRAINT x EXCLUDE USING btree ((app.k(n)) WITH =)
         DEFERRABLE INITIALLY DEFERRED;
       INSERT INTO app.ticks VALUES (1, 1), (2, 1);
       UPDATE app.ticks SET n = 3 WHERE id = 1`,
      'guard 9: constraint x on app.ticks is deferrable and not allow-listed',
    ],
    [
      'a journal index predicate that unpins the search path when planned',
      `CREATE TABLE app.cases (id uuid PRIMARY KEY);
       CREATE FUNCTION app.always(text, text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
       CREATE OPERATOR app.= (LEFTARG = text, RIGHTARG = text, FUNCTION = app.always);
       CREATE FUNCTION app.unpin(int) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
         BEGIN PERFORM pg_catalog.set_config('search_path', 'app, pg_catalog', true); RETURN true; END $$;
       ALTER TABLE arca_migrations.journal DROP CONSTRAINT journal_pkey;
       CREATE INDEX journal_p ON arca_migrations.journal (name) WHERE app.unpin(1)`,
      'the journal table has an index other than its plain primary key',
    ],
    [
      'a journal child table whose index predicate unpins the search path',
      `CREATE TABLE app.cases (id uuid PRIMARY KEY);
       CREATE FUNCTION app.always(text, text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
       CREATE OPERATOR app.= (LEFTARG = text, RIGHTARG = text, FUNCTION = app.always);
       CREATE FUNCTION app.unpin(int) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
         BEGIN PERFORM pg_catalog.set_config('search_path', 'app, pg_catalog', true); RETURN true; END $$;
       CREATE TABLE app.journal_child () INHERITS (arca_migrations.journal);
       ALTER TABLE app.journal_child ENABLE ROW LEVEL SECURITY;
       ALTER TABLE app.journal_child FORCE ROW LEVEL SECURITY;
       CREATE INDEX journal_child_p ON app.journal_child (name) WHERE app.unpin(1)`,
      'the journal table has inheritance',
    ],
    [
      'journal statistics whose expression unpins the search path',
      `CREATE TABLE app.cases (id uuid PRIMARY KEY);
       CREATE FUNCTION app.always(text, text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
       CREATE OPERATOR app.= (LEFTARG = text, RIGHTARG = text, FUNCTION = app.always);
       CREATE FUNCTION app.unpin(int) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
         BEGIN PERFORM pg_catalog.set_config('search_path', 'app, pg_catalog', true); RETURN true; END $$;
       CREATE STATISTICS app.journal_s ON (app.unpin(1)) FROM arca_migrations.journal`,
      'the journal table has extended statistics',
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

  it('never runs a deferred event whose trigger the migration dropped', async () => {
    const files = await realMigrations();
    const policy = await containerPolicy();
    const sql = `CREATE TABLE app.ticks (id int);
      ALTER TABLE app.ticks ENABLE ROW LEVEL SECURITY;
      ALTER TABLE app.ticks FORCE ROW LEVEL SECURITY;
      CREATE POLICY open ON app.ticks USING (true) WITH CHECK (true);
      CREATE FUNCTION app.late() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN EXECUTE 'CREATE TABLE app.leak (id int)'; RETURN NULL; END $$;
      CREATE CONSTRAINT TRIGGER late AFTER INSERT ON app.ticks
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.late();
      INSERT INTO app.ticks VALUES (1);
      DROP TRIGGER late ON app.ticks;`;
    await migrate(
      migratorTarget(database),
      [...files, migration('20990101000000_drop', sql)],
      policy,
    );
    await withClient(adminTarget(database), async (client) => {
      const leak = await client.query(`SELECT pg_catalog.to_regclass('app.leak') AS leak`);
      expect(leak.rows).toEqual([{ leak: null }]);
      expect(await runGuards(client, policy)).toEqual([]);
    });
  });

  it('ignores PGOPTIONS and PGCLIENTENCODING, so the server lexes as the parser does', async () => {
    const overrides = {
      PGOPTIONS: '-c standard_conforming_strings=off',
      PGCLIENTENCODING: 'SJIS',
    };
    const saved = Object.fromEntries(
      Object.keys(overrides).map((name) => [name, process.env[name]]),
    );
    Object.assign(process.env, overrides);
    try {
      const settings = await withClient(migratorTarget(database), async (client) => {
        const result = await client.query<{ conforming: string; encoding: string }>(
          `SELECT pg_catalog.current_setting('standard_conforming_strings') AS conforming,
                  pg_catalog.current_setting('client_encoding') AS encoding`,
        );
        return result.rows[0];
      });
      expect(settings).toEqual({ conforming: 'on', encoding: 'UTF8' });
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) Reflect.deleteProperty(process.env, name);
        else process.env[name] = value;
      }
    }
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
