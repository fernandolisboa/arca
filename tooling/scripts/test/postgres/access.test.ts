import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/runner.ts';
import { runtimeRoles } from '../../src/db/policy.ts';
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
 * The access matrix over the real migrations (spec 0003, R1): which runtime role may touch the
 * auth schema, and how. Read from the catalog, so a grant added by any later migration shows up.
 */
let database: string;
beforeAll(async () => {
  database = await freshDatabase();
  await migrate(migratorTarget(database), await realMigrations(), await containerPolicy());
});
afterAll(async () => {
  await dropDatabase(database);
});

const authTables = ['account', 'passkey', 'session', 'user', 'verification'];
const tablePrivileges = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
];

async function privileges(role: string): Promise<Record<string, string[]>> {
  return withClient(adminTarget(database), async (client) => {
    const schema = await client.query<{ usage: boolean; create: boolean }>(
      `SELECT pg_catalog.has_schema_privilege($1, 'auth', 'USAGE') AS usage,
              pg_catalog.has_schema_privilege($1, 'auth', 'CREATE') AS create`,
      [role],
    );
    const result: Record<string, string[]> = {
      schema: Object.entries(schema.rows[0] ?? {})
        .filter(([, granted]) => granted)
        .map(([privilege]) => privilege.toUpperCase()),
    };
    for (const table of authTables) {
      const granted: string[] = [];
      for (const privilege of tablePrivileges) {
        const row = await client.query<{ granted: boolean }>(
          `SELECT pg_catalog.has_table_privilege($1, pg_catalog.format('auth.%I', $2::text), $3) AS granted`,
          [role, table, privilege],
        );
        if (row.rows[0]?.granted === true) granted.push(privilege);
      }
      result[table] = granted;
    }
    return result;
  });
}

describe('the auth schema access matrix', () => {
  it('has exactly the tables the matrix lists', async () => {
    const tables = await withClient(adminTarget(database), async (client) => {
      const result = await client.query<{ name: string }>(
        `SELECT c.relname AS name FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'auth' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY 1`,
      );
      return result.rows.map((row) => row.name);
    });
    expect(tables).toEqual(authTables);
  });

  it('lets app_auth read and write its tables, and nothing more', async () => {
    const dml = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
    expect(await privileges('app_auth')).toEqual({
      schema: ['USAGE'],
      ...Object.fromEntries(authTables.map((table) => [table, dml])),
    });
  });

  it.each(runtimeRoles.filter((role) => role !== 'app_auth'))(
    'gives %s no access to the auth schema',
    async (role) => {
      expect(await privileges(role)).toEqual({
        schema: [],
        ...Object.fromEntries(authTables.map((table) => [table, []])),
      });
    },
  );
});
