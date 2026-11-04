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
 * The notification schema's access matrix (spec 0005, R7): which role holds which privilege, and
 * that row-level security confines app_api and app_jobs to the identity's own rows.
 */
let database: string;
const owner = '0b9c3d6e-1f2a-4b5c-8d7e-9f0a1b2c3d4e';
const other = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const p256dh = 'B'.repeat(87);
const authSecret = 'C'.repeat(22);
const pushChannel = (account: string, endpoint: string) => ({
  sql: `INSERT INTO notification.channel (account_id, kind, endpoint, p256dh, auth_secret, browser, os)
        VALUES ($1, 'web_push', $2, $3, $4, 'firefox', 'linux')`,
  values: [account, endpoint, p256dh, authSecret],
});

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
        `INSERT INTO notification.channel (id, account_id, kind) VALUES ($1, $1, 'email')`,
        [id],
      );
      await client.query(
        `INSERT INTO notification.message (id, account_id, code) VALUES ($1, $1, 'passkey_added')`,
        [id],
      );
      await client.query(
        `INSERT INTO notification.delivery (account_id, message_id, channel_id) VALUES ($1, $1, $1)`,
        [id],
      );
    }
  });
});
afterAll(async () => {
  await dropDatabase(database);
});

const tables = {
  channel: [
    'id',
    'account_id',
    'kind',
    'endpoint',
    'p256dh',
    'auth_secret',
    'browser',
    'os',
    'created_at',
    'last_success_at',
  ],
  delivery: ['account_id', 'message_id', 'channel_id', 'delivered_at'],
  message: ['id', 'account_id', 'code', 'entity_id', 'details', 'created_at'],
} as const;
type Table = keyof typeof tables;

/** Per table: the columns each column privilege covers, and the table-level privileges. */
async function privileges(role: string) {
  return withClient(adminTarget(database), async (client) => {
    const usage = await client.query<{ usage: boolean; create: boolean }>(
      `SELECT pg_catalog.has_schema_privilege($1, 'notification', 'USAGE') AS usage,
              pg_catalog.has_schema_privilege($1, 'notification', 'CREATE') AS create`,
      [role],
    );
    const result: Record<string, Record<string, string[]>> = {};
    for (const [table, columns] of Object.entries(tables)) {
      const granted: Record<string, string[]> = {};
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) {
        const list: string[] = [];
        for (const column of columns) {
          const row = await client.query<{ granted: boolean }>(
            `SELECT pg_catalog.has_column_privilege($1, pg_catalog.format('notification.%I', $2::text), $3, $4) AS granted`,
            [role, table, column, privilege],
          );
          if (row.rows[0]?.granted === true) list.push(column);
        }
        if (list.length > 0) granted[privilege] = list;
      }
      for (const privilege of ['DELETE', 'TRUNCATE', 'TRIGGER']) {
        const row = await client.query<{ granted: boolean }>(
          `SELECT pg_catalog.has_table_privilege($1, pg_catalog.format('notification.%I', $2::text), $3) AS granted`,
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
    .query<{
      account_id: string;
    }>(`SELECT account_id FROM notification.${table} ORDER BY account_id`)
    .then((result) => result.rows.map((row) => row.account_id));

const rowLevelRefusal = /row-level security/;

describe('the notification schema access matrix (spec 0005, R7)', () => {
  it('forces row-level security on exactly the three tables', async () => {
    const shape = await withClient(adminTarget(database), async (client) => {
      const result = await client.query<{ name: string; forced: boolean }>(
        `SELECT c.relname AS name, c.relrowsecurity AND c.relforcerowsecurity AS forced
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'notification' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY 1`,
      );
      return result.rows;
    });
    expect(shape).toEqual(Object.keys(tables).map((name) => ({ name, forced: true })));
  });

  it('gives app_api push channels and messages, and only reads of deliveries', async () => {
    expect(await privileges('app_api')).toEqual({
      usage: { usage: true, create: false },
      channel: {
        SELECT: tables.channel,
        INSERT: ['account_id', 'kind', 'endpoint', 'p256dh', 'auth_secret', 'browser', 'os'],
        DELETE: ['*'],
      },
      delivery: { SELECT: tables.delivery },
      message: {
        SELECT: tables.message,
        INSERT: ['account_id', 'code', 'entity_id', 'details'],
      },
    });
  });

  it('gives app_jobs the delivery, the email channel and erasure', async () => {
    expect(await privileges('app_jobs')).toEqual({
      usage: { usage: true, create: false },
      channel: {
        SELECT: tables.channel,
        INSERT: ['account_id', 'kind'],
        UPDATE: ['last_success_at'],
        DELETE: ['*'],
      },
      delivery: {
        SELECT: tables.delivery,
        INSERT: ['account_id', 'message_id', 'channel_id'],
        DELETE: ['*'],
      },
      message: {
        SELECT: tables.message,
        INSERT: ['account_id', 'code', 'entity_id', 'details'],
        DELETE: ['*'],
      },
    });
  });

  it.each([
    ...runtimeRoles.filter((role) => !['app_api', 'app_jobs'].includes(role)),
    ...retiredRoles,
  ])('gives %s no access to the notification schema', async (role) => {
    expect(await privileges(role)).toEqual({
      usage: { usage: false, create: false },
      channel: {},
      delivery: {},
      message: {},
    });
  });

  it.each(['app_api', 'app_jobs'] as const)(
    'shows %s only the identity’s own rows, and none without an identity',
    async (role) => {
      for (const table of Object.keys(tables) as Table[]) {
        expect(await as(role, owner, (client) => accounts(client, table))).toEqual([owner]);
        expect(await as(role, undefined, (client) => accounts(client, table))).toEqual([]);
      }
    },
  );

  it("refuses app_api rows for another account, and deletes none of another's", async () => {
    const other_ = pushChannel(other, 'https://push.example.com/send/2');
    await expect(
      as('app_api', owner, (client) => client.query(other_.sql, other_.values)),
    ).rejects.toThrow(rowLevelRefusal);
    await expect(
      as('app_api', owner, (client) =>
        client.query(
          `INSERT INTO notification.message (account_id, code) VALUES ($1, 'passkey_added')`,
          [other],
        ),
      ),
    ).rejects.toThrow(rowLevelRefusal);
    const deleted = await as(
      'app_api',
      owner,
      async (client) =>
        (await client.query(`DELETE FROM notification.channel WHERE account_id = $1`, [other]))
          .rowCount,
    );
    expect(deleted).toBe(0);
  });

  it("lets app_jobs under one identity write nothing of another account's", async () => {
    await expect(
      as('app_jobs', owner, (client) =>
        client.query(
          `INSERT INTO notification.delivery (account_id, message_id, channel_id) VALUES ($1, $1, $1)`,
          [other],
        ),
      ),
    ).rejects.toThrow(rowLevelRefusal);
    await expect(
      as('app_jobs', owner, (client) =>
        client.query(
          `INSERT INTO notification.message (account_id, code) VALUES ($1, 'passkey_added')`,
          [other],
        ),
      ),
    ).rejects.toThrow(rowLevelRefusal);
    const changed = await as('app_jobs', owner, async (client) => {
      const counts = [
        (
          await client.query(
            `UPDATE notification.channel SET last_success_at = now() WHERE account_id = $1`,
            [other],
          )
        ).rowCount,
      ];
      for (const table of ['delivery', 'message', 'channel'] as const) {
        counts.push(
          (await client.query(`DELETE FROM notification.${table} WHERE account_id = $1`, [other]))
            .rowCount,
        );
      }
      return counts;
    });
    expect(changed).toEqual([0, 0, 0, 0]);
  });

  it("refuses a delivery that ties the identity's row to another account's message", async () => {
    await expect(
      as('app_jobs', owner, (client) =>
        client.query(
          `INSERT INTO notification.delivery (account_id, message_id, channel_id) VALUES ($1, $2, $1)`,
          [owner, other],
        ),
      ),
    ).rejects.toThrow(/delivery_message_fkey/);
  });

  it('keeps one email channel per account and one channel per push endpoint', async () => {
    await expect(
      as('app_jobs', owner, (client) =>
        client.query(`INSERT INTO notification.channel (account_id, kind) VALUES ($1, 'email')`, [
          owner,
        ]),
      ),
    ).rejects.toThrow(/duplicate key/);
    const push = pushChannel(owner, 'https://push.example.com/send/1');
    await expect(
      as('app_api', owner, async (client) => {
        await client.query(push.sql, push.values);
        await client.query(push.sql, push.values);
      }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('refuses a push channel without its keys, over plain http, or an email channel with them', async () => {
    const refused = (sql: string, values: unknown[]) =>
      expect(as('app_api', owner, (client) => client.query(sql, values))).rejects.toThrow(
        /channel_/,
      );
    await refused(
      `INSERT INTO notification.channel (account_id, kind, endpoint) VALUES ($1, 'web_push', 'https://push.example.com/send/3')`,
      [owner],
    );
    const plain = pushChannel(owner, 'http://push.example.com/send/4');
    await refused(plain.sql, plain.values);
    await refused(
      `INSERT INTO notification.channel (account_id, kind, endpoint) VALUES ($1, 'email', 'https://push.example.com/send/5')`,
      [owner],
    );
  });

  it('deletes a channel’s and a message’s deliveries with them', async () => {
    const left = await as('app_jobs', owner, async (client) => {
      await client.query(`DELETE FROM notification.channel WHERE account_id = $1`, [owner]);
      const result = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM notification.delivery`,
      );
      return result.rows[0];
    });
    expect(left).toEqual({ n: 0 });
  });
});
