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

const authTables = [
  'account',
  'outbox',
  'passkey',
  'passkey_client',
  'rate_limit',
  'session',
  'step_up',
  'step_up_challenge',
  'user',
  'verification',
];
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
      outbox: ['SELECT', 'INSERT', 'DELETE'],
      passkey_client: ['SELECT', 'INSERT', 'DELETE'],
      step_up: ['SELECT', 'INSERT', 'DELETE'],
      step_up_challenge: ['SELECT', 'INSERT', 'DELETE'],
    });
  });

  it('lets app_auth update only when a step-up was spent', async () => {
    const updatable = await withClient(adminTarget(database), async (client) => {
      const result = await client.query<{ name: string }>(
        `SELECT attname AS name FROM pg_catalog.pg_attribute
          WHERE attrelid = 'auth.step_up'::regclass AND attnum > 0 AND NOT attisdropped
            AND pg_catalog.has_column_privilege('app_auth', attrelid, attnum, 'UPDATE')`,
      );
      return result.rows.map((row) => row.name);
    });
    expect(updatable).toEqual(['consumed_at']);
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

const auditColumns = [
  'id',
  'time',
  'actor_account_id',
  'subject_account_id',
  'code',
  'request_id',
  'details',
];

/** Per column, the privileges a role holds on audit.event, table-level grants included. */
async function auditPrivileges(role: string) {
  return withClient(adminTarget(database), async (client) => {
    const schema = await client.query<{ usage: boolean }>(
      `SELECT pg_catalog.has_schema_privilege($1, 'audit', 'USAGE') AS usage`,
      [role],
    );
    const columns: Record<string, string[]> = {};
    for (const column of auditColumns) {
      const granted: string[] = [];
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) {
        const row = await client.query<{ granted: boolean }>(
          `SELECT pg_catalog.has_column_privilege($1, 'audit.event', $2, $3) AS granted`,
          [role, column, privilege],
        );
        if (row.rows[0]?.granted) granted.push(privilege);
      }
      columns[column] = granted;
    }
    const table: string[] = [];
    for (const privilege of ['DELETE', 'TRUNCATE', 'TRIGGER']) {
      const row = await client.query<{ granted: boolean }>(
        `SELECT pg_catalog.has_table_privilege($1, 'audit.event', $2) AS granted`,
        [role, privilege],
      );
      if (row.rows[0]?.granted) table.push(privilege);
    }
    return { usage: schema.rows[0]?.usage, columns, table };
  });
}

const onEveryColumn = (privileges: string[]) =>
  Object.fromEntries(auditColumns.map((column) => [column, privileges]));

describe('the audit schema access matrix (spec 0003, R7)', () => {
  it('has only the event table, with no foreign keys and forced row-level security', async () => {
    const shape = await withClient(adminTarget(database), async (client) => {
      const tables = await client.query<{ name: string; forced: boolean }>(
        `SELECT c.relname AS name, c.relrowsecurity AND c.relforcerowsecurity AS forced
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'audit' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY 1`,
      );
      const foreignKeys = await client.query(
        `SELECT FROM pg_catalog.pg_constraint k
           JOIN pg_catalog.pg_namespace n ON n.oid = k.connamespace
          WHERE n.nspname = 'audit' AND k.contype = 'f'`,
      );
      return { tables: tables.rows, foreignKeys: foreignKeys.rowCount };
    });
    expect(shape).toEqual({ tables: [{ name: 'event', forced: true }], foreignKeys: 0 });
  });

  it('lets app_audit insert every column but the ID and the time, and nothing else', async () => {
    expect(await auditPrivileges('app_audit')).toEqual({
      usage: true,
      columns: {
        ...onEveryColumn(['INSERT']),
        id: [],
        time: [],
      },
      table: [],
    });
  });

  it('lets app_api only read', async () => {
    expect(await auditPrivileges('app_api')).toEqual({
      usage: true,
      columns: onEveryColumn(['SELECT']),
      table: [],
    });
  });

  it.each(runtimeRoles.filter((role) => role !== 'app_audit' && role !== 'app_api'))(
    'gives %s no access to the audit schema',
    async (role) => {
      expect(await auditPrivileges(role)).toEqual({
        usage: false,
        columns: onEveryColumn([]),
        table: [],
      });
    },
  );
});
