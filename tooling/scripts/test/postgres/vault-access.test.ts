import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/runner.ts';
import { retiredRoles, runtimeRoles } from '../../src/db/policy.ts';
import {
  adminTarget,
  containerPolicy,
  dropDatabase,
  freshDatabase,
  migratorTarget,
  realMigrations,
  roleTarget,
  withClient,
} from './support.ts';

/**
 * The vault schema's access matrix (spec 0005, R2): which role holds which privilege, and that
 * row-level security confines app_api and app_jobs to the identity's own rows.
 */
let database: string;
const owner = '0b9c3d6e-1f2a-4b5c-8d7e-9f0a1b2c3d4e';
const other = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const recipientOf = (account: string) => `age1pq1${account === owner ? 'qqqq' : 'pppp'}`;
const sealed = Buffer.alloc(128, 7);

beforeAll(async () => {
  database = await freshDatabase();
  await migrate(migratorTarget(database), await realMigrations(), await containerPolicy());
  await withClient(adminTarget(database), async (client) => {
    for (const [id, email] of [
      [owner, 'owner@example.com'],
      [other, 'other@example.com'],
    ] as const) {
      await client.query(`INSERT INTO auth.user (id, name, email) VALUES ($1, 'Synthetic', $2)`, [
        id,
        email,
      ]);
      await client.query(
        `INSERT INTO vault.recipient (id, account_id, recipient) VALUES ($1, $1, $2)`,
        [id, recipientOf(id)],
      );
      await client.query(
        `INSERT INTO vault.envelope (account_id, recipient_id, kind, credential_id, ciphertext)
         VALUES ($1, $1, 'passkey_prf', 'synthetic-credential-one', $2), ($1, $1, 'recovery', NULL, $2)`,
        [id, sealed],
      );
      await client.query(
        `INSERT INTO vault.sharing_state (account_id, version, state, tag) VALUES ($1, 1, '\\x7b7d', $2)`,
        [id, Buffer.alloc(32)],
      );
    }
  });
});
afterAll(async () => {
  await dropDatabase(database);
});

const tables = {
  envelope: [
    'id',
    'account_id',
    'recipient_id',
    'kind',
    'credential_id',
    'ciphertext',
    'created_at',
  ],
  recipient: ['id', 'account_id', 'recipient', 'created_at', 'rotated_at'],
  sharing_state: ['account_id', 'version', 'state', 'tag', 'updated_at'],
} as const;
type Table = keyof typeof tables;

/** Per table: the columns each column privilege covers, and the table-level privileges. */
async function privileges(role: string) {
  return withClient(adminTarget(database), async (client) => {
    const usage = await client.query<{ usage: boolean; create: boolean }>(
      `SELECT pg_catalog.has_schema_privilege($1, 'vault', 'USAGE') AS usage,
              pg_catalog.has_schema_privilege($1, 'vault', 'CREATE') AS create`,
      [role],
    );
    const result: Record<string, Record<string, string[]>> = {};
    for (const [table, columns] of Object.entries(tables)) {
      const granted: Record<string, string[]> = {};
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) {
        const list: string[] = [];
        for (const column of columns) {
          const row = await client.query<{ granted: boolean }>(
            `SELECT pg_catalog.has_column_privilege($1, pg_catalog.format('vault.%I', $2::text), $3, $4) AS granted`,
            [role, table, column, privilege],
          );
          if (row.rows[0]?.granted === true) list.push(column);
        }
        if (list.length > 0) granted[privilege] = list;
      }
      for (const privilege of ['DELETE', 'TRUNCATE', 'TRIGGER']) {
        const row = await client.query<{ granted: boolean }>(
          `SELECT pg_catalog.has_table_privilege($1, pg_catalog.format('vault.%I', $2::text), $3) AS granted`,
          [role, table, privilege],
        );
        if (row.rows[0]?.granted === true) granted[privilege] = ['*'];
      }
      result[table] = granted;
    }
    return { usage: usage.rows[0], ...result };
  });
}

/** Runs `work` as the role, in a transaction acting for `account`, and rolls it back. */
async function as<T>(
  role: 'app_api' | 'app_jobs',
  account: string | undefined,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  return withClient(roleTarget(database, role), async (client) => {
    await client.query('BEGIN');
    try {
      if (account !== undefined) {
        await client.query(`SELECT pg_catalog.set_config('app.account_id', $1, true)`, [account]);
      }
      return await work(client);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

const accounts = (client: pg.Client, table: Table) =>
  client
    .query<{ account_id: string }>(`SELECT account_id FROM vault.${table} ORDER BY account_id`)
    .then((result) => result.rows.map((row) => row.account_id));

describe('the vault schema access matrix (spec 0005, R2)', () => {
  it('forces row-level security on every vault table', async () => {
    const shape = await withClient(adminTarget(database), async (client) => {
      const result = await client.query<{ name: string; forced: boolean }>(
        `SELECT c.relname AS name, c.relrowsecurity AND c.relforcerowsecurity AS forced
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'vault' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY 1`,
      );
      return result.rows;
    });
    // The document tables' own matrix is in document-access.test.ts.
    const names = [...Object.keys(tables), 'document', 'document_recipient'].sort();
    expect(shape).toEqual(names.map((name) => ({ name, forced: true })));
  });

  it('gives app_api reads, inserts and the few updates and deletes the vault needs', async () => {
    expect(await privileges('app_api')).toEqual({
      usage: { usage: true, create: false },
      envelope: {
        SELECT: tables.envelope,
        INSERT: ['account_id', 'recipient_id', 'kind', 'credential_id', 'ciphertext'],
        UPDATE: ['ciphertext'],
        DELETE: ['*'],
      },
      recipient: {
        SELECT: tables.recipient,
        INSERT: ['account_id', 'recipient'],
        UPDATE: ['rotated_at'],
        DELETE: ['*'],
      },
      sharing_state: {
        SELECT: tables.sharing_state,
        INSERT: ['account_id', 'version', 'state', 'tag'],
        UPDATE: ['version', 'state', 'tag', 'updated_at'],
        DELETE: ['*'],
      },
    });
  });

  it('gives app_jobs only reads and deletes', async () => {
    const readAndDelete = (table: Table) => ({ SELECT: tables[table], DELETE: ['*'] });
    expect(await privileges('app_jobs')).toEqual({
      usage: { usage: true, create: false },
      envelope: readAndDelete('envelope'),
      recipient: readAndDelete('recipient'),
      sharing_state: readAndDelete('sharing_state'),
    });
  });

  it.each([
    ...runtimeRoles.filter((role) => !['app_api', 'app_jobs'].includes(role)),
    ...retiredRoles,
  ])('gives %s no access to the vault schema', async (role) => {
    expect(await privileges(role)).toEqual({
      usage: { usage: false, create: false },
      envelope: {},
      recipient: {},
      sharing_state: {},
    });
  });

  it.each(['app_api', 'app_jobs'] as const)(
    'shows %s only the identity’s own rows, and none without an identity',
    async (role) => {
      for (const table of Object.keys(tables) as Table[]) {
        expect(await as(role, owner, (client) => accounts(client, table))).toEqual(
          table === 'envelope' ? [owner, owner] : [owner],
        );
        expect(await as(role, undefined, (client) => accounts(client, table))).toEqual([]);
      }
    },
  );

  it("refuses app_api writes to another account's rows", async () => {
    const refused = (sql: string, values: unknown[]) =>
      expect(as('app_api', owner, (client) => client.query(sql, values))).rejects.toThrow(
        /row-level security/,
      );
    await refused(
      `INSERT INTO vault.recipient (account_id, recipient) VALUES ($1, 'age1pq1zzzz')`,
      [other],
    );
    await refused(
      `INSERT INTO vault.envelope (account_id, recipient_id, kind, ciphertext) VALUES ($1, $1, 'recovery', $2)`,
      [other, sealed],
    );
    await refused(
      `INSERT INTO vault.sharing_state (account_id, version, state, tag) VALUES ($1, 2, '\\x7b7d', $2)`,
      [other, Buffer.alloc(32)],
    );
    const changed = await as('app_api', owner, async (client) => {
      const results = await Promise.all([
        client.query(`UPDATE vault.envelope SET ciphertext = $2 WHERE account_id = $1`, [
          other,
          sealed,
        ]),
        client.query(`DELETE FROM vault.envelope WHERE account_id = $1`, [other]),
        client.query(`UPDATE vault.recipient SET rotated_at = now() WHERE account_id = $1`, [
          other,
        ]),
        client.query(`UPDATE vault.sharing_state SET version = 9 WHERE account_id = $1`, [other]),
      ]);
      return results.map((result) => result.rowCount);
    });
    expect(changed).toEqual([0, 0, 0, 0]);
  });

  it("refuses an envelope tied to another account's recipient", async () => {
    await expect(
      as('app_api', owner, (client) =>
        client.query(
          `INSERT INTO vault.envelope (account_id, recipient_id, kind, credential_id, ciphertext)
           VALUES ($1, $2, 'passkey_prf', 'synthetic-credential-two', $3)`,
          [owner, other, sealed],
        ),
      ),
    ).rejects.toThrow(/envelope_recipient_fkey/);
  });

  it.each(['app_api', 'app_jobs'] as const)(
    "lets %s under one identity delete nothing of another account's",
    async (role) => {
      const erased = await as(role, owner, async (client) => {
        const counts = [];
        for (const table of ['envelope', 'sharing_state', 'recipient'] as const) {
          counts.push(
            (await client.query(`DELETE FROM vault.${table} WHERE account_id = $1`, [other]))
              .rowCount,
          );
        }
        return counts;
      });
      expect(erased).toEqual([0, 0, 0]);
    },
  );

  it('allows one current recipient, one recovery envelope and one envelope per passkey', async () => {
    const duplicate = (sql: string, values: unknown[]) =>
      expect(as('app_api', owner, (client) => client.query(sql, values))).rejects.toThrow(
        /duplicate key/,
      );
    await duplicate(
      `INSERT INTO vault.recipient (account_id, recipient) VALUES ($1, 'age1pq1zzzz')`,
      [owner],
    );
    await duplicate(
      `INSERT INTO vault.envelope (account_id, recipient_id, kind, ciphertext) VALUES ($1, $1, 'recovery', $2)`,
      [owner, sealed],
    );
    await duplicate(
      `INSERT INTO vault.envelope (account_id, recipient_id, kind, credential_id, ciphertext)
       VALUES ($1, $1, 'passkey_prf', 'synthetic-credential-one', $2)`,
      [owner, sealed],
    );
  });

  it('refuses a non-hybrid recipient and a passkey envelope without its credential', async () => {
    await expect(
      as('app_api', owner, async (client) => {
        await client.query(`UPDATE vault.recipient SET rotated_at = now() WHERE account_id = $1`, [
          owner,
        ]);
        await client.query(
          `INSERT INTO vault.recipient (account_id, recipient) VALUES ($1, 'age1qqqq')`,
          [owner],
        );
      }),
    ).rejects.toThrow(/recipient_hybrid/);
    await expect(
      as('app_api', owner, (client) =>
        client.query(
          `INSERT INTO vault.envelope (account_id, recipient_id, kind, ciphertext) VALUES ($1, $1, 'passkey_prf', $2)`,
          [owner, sealed],
        ),
      ),
    ).rejects.toThrow(/envelope_credential_for_passkey/);
  });

  it('refuses an oversized recipient and a rotation dated before creation', async () => {
    await expect(
      as('app_api', owner, async (client) => {
        await client.query(`UPDATE vault.recipient SET rotated_at = now() WHERE account_id = $1`, [
          owner,
        ]);
        await client.query(`INSERT INTO vault.recipient (account_id, recipient) VALUES ($1, $2)`, [
          owner,
          `age1pq1${'q'.repeat(2100)}`,
        ]);
      }),
    ).rejects.toThrow(/recipient_length/);
    await expect(
      as('app_api', owner, (client) =>
        client.query(
          `UPDATE vault.recipient SET rotated_at = created_at - interval '1 day' WHERE account_id = $1`,
          [owner],
        ),
      ),
    ).rejects.toThrow(/recipient_rotated_after_created/);
  });
});
