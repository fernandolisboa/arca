import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database, type Transaction } from '../../src/database.js';
import { withIdentity } from '../../src/identity.js';
import {
  ConnectionCheckError,
  createRolePool,
  roleStatus,
  type DatabaseTarget,
  type RoleCredentials,
  type RuntimeRole,
} from '../../src/pool.js';

// A disposable Postgres 18 server, never a shared one: these tests create roles cluster-wide.
const server = {
  host: process.env['ARCA_TEST_DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['ARCA_TEST_DB_PORT'] ?? '5432'),
};
const adminUser = process.env['ARCA_TEST_DB_ADMIN_USER'] ?? 'postgres';
const adminPassword = process.env['ARCA_TEST_DB_ADMIN_PASSWORD'] ?? '';
if (adminPassword === '') throw new Error('ARCA_TEST_DB_ADMIN_PASSWORD is not set');

const database = `arca_runtime_${randomBytes(6).toString('hex')}`;
const target: DatabaseTarget = { ...server, database, ssl: false };
const passwords: Record<RuntimeRole, string> = {
  app_api: randomBytes(24).toString('base64url'),
  app_jobs: randomBytes(24).toString('base64url'),
};
const credentials = (role: RuntimeRole): RoleCredentials => ({ role, password: passwords[role] });

const personA = '0b9c3d6e-1f2a-4b5c-8d7e-9f0a1b2c3d4e';
const personB = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const someCase = 'c0ffee00-0000-4000-8000-000000000001';

async function asAdmin<T>(name: string, use: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    ...server,
    database: name,
    user: adminUser,
    password: adminPassword,
    ssl: false,
  });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

const pools: pg.Pool[] = [];
function poolFor(role: RuntimeRole, max = 1, onIdleError?: (error: Error) => void): pg.Pool {
  const pool = createRolePool(target, credentials(role), {
    max,
    ...(onIdleError === undefined ? {} : { onIdleError }),
  });
  pools.push(pool);
  return pool;
}

const createdRoles: RuntimeRole[] = [];

beforeAll(async () => {
  await asAdmin('postgres', async (client) => {
    await client.query(`CREATE DATABASE ${database}`);
    for (const role of ['app_api', 'app_jobs'] as const) {
      const exists = await client.query('SELECT FROM pg_catalog.pg_roles WHERE rolname = $1', [
        role,
      ]);
      if (exists.rowCount === 0) createdRoles.push(role);
      await client.query(
        `${exists.rowCount === 0 ? 'CREATE' : 'ALTER'} ROLE ${role} LOGIN PASSWORD '${passwords[role]}'`,
      );
    }
  });
  // A test-only table with the policy shape case tables will use (spec 0001, R7).
  await asAdmin(database, (client) =>
    client.query(`
      CREATE TABLE public.identity_probe (person_id uuid NOT NULL, case_id uuid);
      ALTER TABLE public.identity_probe ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.identity_probe FORCE ROW LEVEL SECURITY;
      CREATE POLICY own_rows ON public.identity_probe
        USING (person_id = nullif(current_setting('app.person_id', true), '')::uuid);
      GRANT SELECT ON public.identity_probe TO app_api;
      INSERT INTO public.identity_probe VALUES
        ('${personA}', NULL), ('${personA}', '${someCase}'), ('${personB}', NULL);
    `),
  );
});

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  await asAdmin('postgres', async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    for (const role of createdRoles) await client.query(`DROP ROLE ${role}`);
  });
});

describe('role pool', () => {
  it('connects as the role it was made for', async () => {
    expect(await roleStatus(poolFor('app_api'), 'app_api')).toBe('ok');
  });

  it('ignores PG* variables that name another role', async () => {
    vi.stubEnv('PGUSER', adminUser);
    vi.stubEnv('PGPASSWORD', adminPassword);
    vi.stubEnv('PGDATABASE', 'postgres');
    try {
      const pool = poolFor('app_api');
      const { rows } = await pool.query<{ role: string; db: string }>(
        'SELECT current_user AS role, current_database() AS db',
      );
      expect(rows[0]).toEqual({ role: 'app_api', db: database });
      expect(() => createRolePool(target, { password: passwords.app_api } as never)).toThrow(
        'database role is missing',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('closes a connection that runs as another role and reports wrong_role', async () => {
    const other = `arca_test_other_${randomBytes(4).toString('hex')}`;
    await asAdmin(database, async (client) => {
      await client.query(`CREATE ROLE ${other} NOLOGIN`);
      await client.query(`GRANT ${other} TO app_api`);
      await client.query(`ALTER ROLE app_api IN DATABASE ${database} SET role = '${other}'`);
    });
    try {
      const pool = poolFor('app_api');
      await expect(pool.query('SELECT 1')).rejects.toMatchObject({
        name: 'ConnectionCheckError',
        reason: 'role',
      });
      expect(pool.totalCount).toBe(0);
      expect(await roleStatus(pool, 'app_api')).toBe('wrong_role');
    } finally {
      await asAdmin(database, async (client) => {
        await client.query(`ALTER ROLE app_api IN DATABASE ${database} RESET role`);
        await client.query(`DROP ROLE ${other}`);
      });
    }
  });

  it('closes a connection that starts with an identity from PGOPTIONS', async () => {
    vi.stubEnv('PGOPTIONS', `-c app.person_id=${personA}`);
    try {
      const pool = poolFor('app_api');
      await expect(pool.query('SELECT 1')).rejects.toBeInstanceOf(ConnectionCheckError);
      await expect(pool.query('SELECT 1')).rejects.toMatchObject({ reason: 'identity' });
      expect(pool.totalCount).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('survives an idle connection being terminated and reconnects', async () => {
    const idleErrors: Error[] = [];
    const pool = poolFor('app_api', 1, (error) => idleErrors.push(error));
    const { rows } = await pool.query<{ pid: number }>('SELECT pg_catalog.pg_backend_pid() AS pid');
    await asAdmin(database, (client) =>
      client.query('SELECT pg_catalog.pg_terminate_backend($1)', [rows[0]?.pid]),
    );
    await vi.waitFor(() => {
      expect(idleErrors).toHaveLength(1);
    });
    expect(await roleStatus(pool, 'app_api')).toBe('ok');
  });
});

describe('withIdentity', () => {
  const probe = sql`SELECT person_id, case_id FROM public.identity_probe ORDER BY case_id NULLS FIRST`;

  async function select(executor: Database | Transaction, query = probe) {
    const result = await executor.execute(query);
    if (Array.isArray(result)) throw new Error('expected one statement');
    return result.rows;
  }

  it('returns no rows without an identity', async () => {
    const db = createDatabase(poolFor('app_api'));
    expect(await select(db)).toEqual([]);
  });

  it('returns only the rows of the person set for the transaction', async () => {
    const db = createDatabase(poolFor('app_api'));
    const rows = await withIdentity(db, { personId: personA, caseId: someCase }, async (tx) => {
      expect(await select(tx, sql`SELECT current_setting('app.case_id', true) AS case_id`)).toEqual(
        [{ case_id: someCase }],
      );
      return select(tx);
    });
    expect(rows).toEqual([
      { person_id: personA, case_id: null },
      { person_id: personA, case_id: someCase },
    ]);
  });

  it('does not carry the identity into the next transaction on the same connection', async () => {
    const pool = poolFor('app_api', 1);
    const db = createDatabase(pool);
    await withIdentity(db, { personId: personB }, async (tx) => {
      expect(await select(tx)).toHaveLength(1);
    });
    const after = await db.transaction(async (tx) => ({
      setting: await select(tx, sql`SELECT current_setting('app.person_id', true) AS person`),
      visible: await select(tx),
    }));
    expect(pool.totalCount).toBe(1);
    expect(after).toEqual({ setting: [{ person: '' }], visible: [] });
  });

  it('fails when work swallowed a database error, instead of committing nothing', async () => {
    const db = createDatabase(poolFor('app_api'));
    await expect(
      withIdentity(db, { personId: personA }, async (tx) => {
        await tx.execute(sql`SELECT 1 / 0`).catch(() => undefined);
        return 'ok';
      }),
    ).rejects.toThrow();
  });

  it('rejects a malformed ID before opening a connection', async () => {
    const pool = poolFor('app_api');
    const db = createDatabase(pool);
    await expect(
      withIdentity(db, { personId: `${personA}'; SELECT 1; --` }, () => Promise.resolve()),
    ).rejects.toThrow('personId is not a UUID');
    expect(pool.totalCount).toBe(0);
  });
});
