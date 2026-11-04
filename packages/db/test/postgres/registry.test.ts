import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registry, type Registry } from '../../src/registry.js';
import { checkRegistry, readCatalog } from './registry-guard.js';

// The real migrations on a disposable Postgres 18 database; the runner's own checks are tested in
// tooling/scripts. Each catalog change below runs in a transaction that is rolled back.
const server = {
  host: process.env['ARCA_TEST_DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['ARCA_TEST_DB_PORT'] ?? '5432'),
  ssl: false,
};
const adminUser = process.env['ARCA_TEST_DB_ADMIN_USER'] ?? 'postgres';
const adminPassword = process.env['ARCA_TEST_DB_ADMIN_PASSWORD'] ?? '';
if (adminPassword === '') throw new Error('ARCA_TEST_DB_ADMIN_PASSWORD is not set');
const migrationsDir = join(import.meta.dirname, '../../migrations');

const database = `arca_registry_${randomBytes(6).toString('hex')}`;
const jobsPassword = randomBytes(24).toString('base64url');
const runtimeRoles = ['app_api', 'app_jobs', 'app_auth', 'app_audit'] as const;
const createdRoles: string[] = [];

const accountA = '0b9c3d6e-1f2a-4b5c-8d7e-9f0a1b2c3d4e';
const accountB = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';

async function connected<T>(
  name: string,
  user: string,
  password: string,
  use: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ ...server, database: name, user, password });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}
const asAdmin = <T>(name: string, use: (client: pg.Client) => Promise<T>) =>
  connected(name, adminUser, adminPassword, use);

beforeAll(async () => {
  await asAdmin('postgres', async (client) => {
    await client.query(`CREATE DATABASE ${database}`);
    for (const role of runtimeRoles) {
      const exists = await client.query('SELECT FROM pg_catalog.pg_roles WHERE rolname = $1', [
        role,
      ]);
      if (exists.rowCount === 0) createdRoles.push(role);
      const password = role === 'app_jobs' ? jobsPassword : randomBytes(24).toString('base64url');
      await client.query(
        `${exists.rowCount === 0 ? 'CREATE' : 'ALTER'} ROLE ${role} LOGIN PASSWORD '${password}'`,
      );
    }
  });
  await asAdmin(database, async (client) => {
    // The runner creates its journal before the first migration; a stand-in is enough here.
    await client.query(
      'CREATE SCHEMA arca_migrations; CREATE TABLE arca_migrations.journal (name text)',
    );
    for (const name of (await readdir(migrationsDir)).sort()) {
      const sql = await readFile(join(migrationsDir, name, 'migration.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) await client.query(statement);
    }
  });
});

afterAll(async () => {
  await asAdmin('postgres', async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    for (const role of createdRoles) await client.query(`DROP ROLE ${role}`);
  });
});

/** The guard's problems after `ddl`, which is rolled back. */
function problemsAfter(ddl: string, checked: Registry = registry): Promise<string[]> {
  return asAdmin(database, async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(ddl);
      return checkRegistry(await readCatalog(client), checked);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

// A table erased by app_jobs, shaped as a case table will be (ADR-0017).
const probe = `
  CREATE TABLE public.probe (account_id uuid NOT NULL, note text);
  ALTER TABLE public.probe ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.probe FORCE ROW LEVEL SECURITY;`;
const identity = `account_id = nullif(current_setting('app.account_id', true), '')::uuid`;
const erasePolicy = `CREATE POLICY probe_erase ON public.probe FOR DELETE TO app_jobs USING (${identity});`;
const readPolicy = `CREATE POLICY probe_read ON public.probe FOR SELECT TO app_jobs USING (${identity});`;
const withProbe: Registry = {
  ...registry,
  entries: [
    ...registry.entries,
    {
      table: 'public.probe',
      strategy: 'delete',
      owner: { column: 'account_id' },
      pool: 'app_jobs',
      export: ['note'],
      label: 'dataExport.tables.probe',
    },
  ],
};

describe('personal-data registry (spec 0004, R7)', () => {
  it('has a decision for every table the migrations create, and each holds', async () => {
    expect(await problemsAfter('SELECT 1')).toEqual([]);
  });

  it('fails on a new table with no decision', async () => {
    expect(await problemsAfter('CREATE TABLE public.throwaway (id uuid)')).toEqual([
      'public.throwaway has no registry decision',
    ]);
  });

  it('fails on a decision for a table that does not exist, or a listed column that does not', async () => {
    const [user, ...rest] = registry.entries;
    if (user === undefined) throw new Error('the registry is empty');
    expect(
      await problemsAfter('SELECT 1', {
        entries: [{ ...user, export: [...user.export, 'shoe_size'] }, ...rest],
        unowned: [
          ...registry.unowned,
          { table: 'public.gone', personalData: 'none', reason: 'test' },
        ],
      }),
    ).toEqual([
      'auth.user has no column shoe_size',
      'public.gone is in the registry but does not exist',
    ]);
  });

  it('fails on a foreign key from audit', async () => {
    expect(
      await problemsAfter(
        `ALTER TABLE audit.event ADD CONSTRAINT event_subject FOREIGN KEY (subject_account_id) REFERENCES auth.user (id)`,
      ),
    ).toEqual(['foreign key event_subject on audit.event leaves audit']);
  });

  it.each([
    [
      'into auth',
      'CREATE TABLE public.parent (id uuid PRIMARY KEY); ALTER TABLE auth.passkey ADD COLUMN parent_id uuid REFERENCES public.parent (id) ON DELETE CASCADE',
      'auth.passkey',
    ],
    [
      'out of auth',
      'CREATE TABLE public.child (account_id uuid REFERENCES auth.user (id) ON DELETE SET NULL)',
      'public.child',
    ],
  ])('fails on a foreign key cascading %s', async (_direction, ddl, table) => {
    expect(await problemsAfter(ddl)).toContainEqual(
      expect.stringMatching(
        new RegExp(`^foreign key \\S+ on ${table} cascades across the auth schema$`),
      ),
    );
  });

  it('fails on an auth entry not erased by app_auth', async () => {
    expect(
      await problemsAfter('SELECT 1', {
        ...registry,
        entries: registry.entries.map((entry) =>
          entry.table === 'auth.session' && entry.strategy === 'delete'
            ? { ...entry, pool: 'app_jobs' }
            : entry,
        ),
      }),
    ).toContain('auth.session is in auth but is not deleted by app_auth');
  });

  it('fails on a child entry without a cascading foreign key to its parent', async () => {
    expect(
      await problemsAfter(
        'ALTER TABLE auth.passkey_capability DROP CONSTRAINT passkey_capability_credential_id_passkey_credential_id_fkey',
      ),
    ).toEqual(['auth.passkey_capability has no ON DELETE CASCADE foreign key to auth.passkey']);
  });

  describe('app_jobs erase policies', () => {
    it('passes with a DELETE and a SELECT policy on the identity', async () => {
      expect(await problemsAfter(`${probe} ${erasePolicy} ${readPolicy}`, withProbe)).toEqual([]);
    });

    it.each([
      ['no DELETE policy', readPolicy, 'public.probe has no app_jobs DELETE policy'],
      [
        'no SELECT policy',
        erasePolicy,
        'public.probe has no app_jobs SELECT policy on the identity',
      ],
      [
        'a DELETE policy of true',
        `CREATE POLICY probe_erase ON public.probe FOR DELETE TO app_jobs USING (true); ${readPolicy}`,
        'public.probe policy probe_erase lets app_jobs delete beyond the identity',
      ],
      [
        'a second, wider policy for every command',
        `${erasePolicy} ${readPolicy} CREATE POLICY probe_all ON public.probe USING (note IS NOT NULL)`,
        'public.probe policy probe_all lets app_jobs delete beyond the identity',
      ],
    ])('fails with %s', async (_case, policies, problem) => {
      expect(await problemsAfter(`${probe} ${policies}`, withProbe)).toEqual([problem]);
    });
  });

  it('lets app_jobs under one identity delete nothing another account owns', async () => {
    await asAdmin(database, (client) =>
      client.query(`${probe} ${erasePolicy} ${readPolicy}
        GRANT USAGE ON SCHEMA public TO app_jobs;
        GRANT SELECT, DELETE ON public.probe TO app_jobs;
        INSERT INTO public.probe VALUES ('${accountA}', 'a'), ('${accountB}', 'b');`),
    );
    try {
      const deleted = await connected(database, 'app_jobs', jobsPassword, async (client) => {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.account_id', $1, true)`, [accountA]);
        const result = await client.query('DELETE FROM public.probe');
        await client.query('COMMIT');
        return result.rowCount;
      });
      expect(deleted).toBe(1);
      const left = await asAdmin(database, (client) =>
        client.query<{ account_id: string }>('SELECT account_id FROM public.probe'),
      );
      expect(left.rows).toEqual([{ account_id: accountB }]);
    } finally {
      await asAdmin(database, (client) =>
        client.query('DROP TABLE public.probe; REVOKE USAGE ON SCHEMA public FROM app_jobs'),
      );
    }
  });
});
