import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { bootstrap, renderBootstrap, type RolePasswords } from '../../src/db/bootstrap.ts';
import { clientFor, requiredVariable, type ConnectionTarget } from '../../src/db/connection.ts';
import { checksum, readMigrations, type MigrationFile } from '../../src/db/migrations.ts';
import { readDatabasePolicy, type DatabasePolicy } from '../../src/db/policy.ts';
import { migratorRole } from '../../src/db/runner.ts';

// A disposable Postgres 18 server, never a shared one: the tests create roles cluster-wide.
const env = process.env;
const server = {
  host: env['ARCA_TEST_DB_HOST'] ?? '127.0.0.1',
  port: Number(env['ARCA_TEST_DB_PORT'] ?? '5432'),
  ssl: false,
};
const adminUser = env['ARCA_TEST_DB_ADMIN_USER'] ?? 'postgres';
const adminPassword = requiredVariable(env, 'ARCA_TEST_DB_ADMIN_PASSWORD');

const generated = () => randomBytes(24).toString('base64url');
export const passwords: RolePasswords = {
  app_migrator: generated(),
  app_api: generated(),
  app_jobs: generated(),
};

const dbPackage = join(import.meta.dirname, '../../../../packages/db');

export function adminTarget(database: string): ConnectionTarget {
  return { ...server, database, user: adminUser, password: adminPassword };
}

export function roleTarget(database: string, user: keyof RolePasswords): ConnectionTarget {
  return { ...server, database, user, password: passwords[user] };
}

export const migratorTarget = (database: string) => roleTarget(database, migratorRole);

export async function withClient<T>(
  target: ConnectionTarget,
  use: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = clientFor(target, 'arca-db-test');
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

export async function bootstrapSql(): Promise<string> {
  return renderBootstrap(await readFile(join(dbPackage, 'bootstrap.sql'), 'utf8'), passwords);
}

/** A new, empty database with the roles bootstrapped into it. */
export async function freshDatabase(): Promise<string> {
  const name = `arca_test_${randomBytes(6).toString('hex')}`;
  await withClient(adminTarget('postgres'), (client) => client.query(`CREATE DATABASE ${name}`));
  await bootstrap(adminTarget(name), await bootstrapSql());
  return name;
}

export async function dropDatabase(name: string): Promise<void> {
  await withClient(adminTarget('postgres'), (client) =>
    client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`),
  );
}

export const containerPolicy = (): Promise<DatabasePolicy> =>
  readDatabasePolicy(join(dbPackage, 'policy'), 'container');

export const realMigrations = (): Promise<MigrationFile[]> =>
  readMigrations(join(dbPackage, 'migrations'));

export function migration(name: string, sql: string): MigrationFile {
  return { name, sql, checksum: checksum(sql) };
}
