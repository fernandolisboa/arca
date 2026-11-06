import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import type { Database } from '@arca/db';
import { apiDatabase, auditDatabase, authDatabase, roleDatabase } from '../../src/database.js';
import type { Logger } from '@arca/telemetry';

// The real migrations on a disposable database, reached through the runtime roles' own pools
// (spec 0003, R1). Synthetic data only.
const host = process.env['ARCA_TEST_DB_HOST'] ?? '127.0.0.1';
const port = Number(process.env['ARCA_TEST_DB_PORT'] ?? '5432');
const adminUser = process.env['ARCA_TEST_DB_ADMIN_USER'] ?? 'postgres';
const adminPassword = process.env['ARCA_TEST_DB_ADMIN_PASSWORD'] ?? '';
const migrationsDir = join(import.meta.dirname, '../../../../packages/db/migrations');

export const silentLogger: Logger = { info: () => undefined, error: () => undefined };

async function asAdminOn<T>(name: string, use: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    host,
    port,
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

export interface AuthTestDatabase {
  readonly authDb: Database;
  readonly auditDb: Database;
  readonly apiDb: Database;
  readonly jobsDb: Database;
  /** Runs as the server's admin on the test database, for setup and checks the roles may not do. */
  readonly asAdmin: <T>(use: (client: pg.Client) => Promise<T>) => Promise<T>;
  /** Closes the pools and drops the database. */
  readonly drop: () => Promise<void>;
}

export async function authTestDatabase(): Promise<AuthTestDatabase> {
  if (adminPassword === '') throw new Error('ARCA_TEST_DB_ADMIN_PASSWORD is not set');
  const database = `arca_auth_${randomBytes(6).toString('hex')}`;
  const passwords = {
    app_auth: randomBytes(24).toString('base64url'),
    app_audit: randomBytes(24).toString('base64url'),
    app_api: randomBytes(24).toString('base64url'),
    app_jobs: randomBytes(24).toString('base64url'),
  };
  await asAdminOn('postgres', async (client) => {
    await client.query(`CREATE DATABASE ${database}`);
    for (const [role, password] of Object.entries(passwords)) {
      const exists = await client.query('SELECT FROM pg_catalog.pg_roles WHERE rolname = $1', [
        role,
      ]);
      await client.query(
        `${exists.rowCount === 0 ? 'CREATE' : 'ALTER'} ROLE ${role} LOGIN PASSWORD '${password}'`,
      );
    }
    // Roles without login: app_backup is retired (ADR-0021) and kept only so the migrations that
    // once granted to it replay; cases_definer owns the case schema's definer functions (spec 0007).
    for (const role of ['app_backup', 'cases_definer']) {
      await client.query(
        `DO $$ BEGIN
           IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${role}') THEN
             CREATE ROLE ${role};
           END IF;
           ALTER ROLE ${role} NOLOGIN NOINHERIT;
         END $$`,
      );
    }
  });
  // The runner's checks are tested in tooling/scripts; here the migrations only need to exist.
  await asAdminOn(database, async (client) => {
    // The runner creates its journal before the first migration; a stand-in is enough here.
    await client.query(
      'CREATE SCHEMA arca_migrations; CREATE TABLE arca_migrations.journal (name text)',
    );
    for (const name of (await readdir(migrationsDir)).sort()) {
      const sql = await readFile(join(migrationsDir, name, 'migration.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) await client.query(statement);
    }
  });
  const target = { host, port, database, ssl: false };
  const pools = [
    authDatabase(target, passwords.app_auth, silentLogger),
    auditDatabase(target, passwords.app_audit, silentLogger),
    apiDatabase(target, passwords.app_api, silentLogger),
    roleDatabase('app_jobs', target, passwords.app_jobs, silentLogger),
  ] as const;
  await Promise.all(pools.map((pool) => pool.ready()));
  const [authPool, auditPool, apiPool, jobsPool] = pools;
  return {
    authDb: authPool.db,
    auditDb: auditPool.db,
    apiDb: apiPool.db,
    jobsDb: jobsPool.db,
    asAdmin: (use) => asAdminOn(database, use),
    drop: async () => {
      await Promise.all(pools.map((pool) => pool.close()));
      await asAdminOn('postgres', (client) =>
        client.query(`DROP DATABASE ${database} WITH (FORCE)`),
      );
    },
  };
}
