import { randomUUID } from 'node:crypto';
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
 * The documents' and account links' access matrix (spec 0005, R4): which role holds which
 * privilege, and what row-level security lets each account read and write. The owner shares
 * with the friend it invited; the stranger has no link to either.
 */
let database: string;
const owner = '1c0e6a4b-2d3f-4e5a-9b6c-7d8e9f0a1b2c';
const friend = '2d1f7b5c-3e4a-4f6b-8c7d-8e9f0a1b2c3d';
const stranger = '3e2a8c6d-4f5b-4a7c-9d8e-9f0a1b2c3d4e';
const shared = '4f3b9d7e-5a6c-4b8d-8e9f-0a1b2c3d4e5f';
const strangers = '5a4c0e8f-6b7d-4c9e-9f0a-1b2c3d4e5f6a';
const unshared = '6b5d1f9a-7c8e-4d0f-8a1b-2c3d4e5f6a7b';
const hash = Buffer.alloc(32, 9);
const objectKey = () => `documents/${randomUUID()}`;

beforeAll(async () => {
  database = await freshDatabase();
  await migrate(migratorTarget(database), await realMigrations(), await containerPolicy());
  await withClient(adminTarget(database), async (client) => {
    for (const [id, email, recipient] of [
      [owner, 'owner@example.com', 'age1pq1qqqq'],
      [friend, 'friend@example.com', 'age1pq1pppp'],
      [stranger, 'stranger@example.com', 'age1pq1zzzz'],
    ] as const) {
      await client.query(`INSERT INTO auth.user (id, name, email) VALUES ($1, 'Synthetic', $2)`, [
        id,
        email,
      ]);
      await client.query(`INSERT INTO vault.recipient (account_id, recipient) VALUES ($1, $2)`, [
        id,
        recipient,
      ]);
    }
    await client.query(
      `INSERT INTO vault.recipient (account_id, recipient, created_at, rotated_at)
       VALUES ($1, 'age1pq1rrrr', now() - interval '2 days', now() - interval '1 day')`,
      [friend],
    );
    await client.query(`INSERT INTO account.link (inviter_id, invitee_id) VALUES ($1, $2)`, [
      owner,
      friend,
    ]);
    await client.query(
      `INSERT INTO vault.document (id, owner_id, type_key, size, sha256, object_key, confirmed_at)
       VALUES ($1, $2, 'passport', 1024, $5, $6, now()), ($3, $2, 'birth_certificate', 2048, $5, $7, now()),
              ($4, $8, 'passport', 512, $5, $9, now())`,
      [shared, owner, unshared, strangers, hash, objectKey(), objectKey(), stranger, objectKey()],
    );
    await client.query(
      `INSERT INTO vault.document_recipient (document_id, document_owner_id, recipient_id)
       VALUES ($1, $2, $3)`,
      [shared, owner, friend],
    );
  });
});
afterAll(async () => {
  await dropDatabase(database);
});

const tables = {
  'account.link': ['inviter_id', 'invitee_id', 'created_at'],
  'vault.document': [
    'id',
    'owner_id',
    'type_key',
    'size',
    'sha256',
    'object_key',
    'created_at',
    'confirmed_at',
  ],
  'vault.document_recipient': ['document_id', 'document_owner_id', 'recipient_id', 'created_at'],
  'vault.document_replacement': [
    'document_id',
    'owner_id',
    'size',
    'sha256',
    'object_key',
    'recipients',
    'created_at',
  ],
  'vault.discarded_object': ['object_key', 'owner_id', 'discarded_at'],
} as const;

/** Per table: the columns each column privilege covers, and the table-level privileges. */
async function privileges(role: string) {
  return withClient(adminTarget(database), async (client) => {
    const result: Record<string, Record<string, string[]>> = {};
    const usage = await client.query<{ usage: boolean }>(
      `SELECT pg_catalog.has_schema_privilege($1, 'account', 'USAGE') AS usage`,
      [role],
    );
    result['account'] = usage.rows[0]?.usage === true ? { USAGE: ['*'] } : {};
    for (const [table, columns] of Object.entries(tables)) {
      const granted: Record<string, string[]> = {};
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) {
        const list: string[] = [];
        for (const column of columns) {
          const row = await client.query<{ granted: boolean }>(
            `SELECT pg_catalog.has_column_privilege($1, $2, $3, $4) AS granted`,
            [role, table, column, privilege],
          );
          if (row.rows[0]?.granted === true) list.push(column);
        }
        if (list.length > 0) granted[privilege] = list;
      }
      for (const privilege of ['DELETE', 'TRUNCATE', 'TRIGGER']) {
        const row = await client.query<{ granted: boolean }>(
          `SELECT pg_catalog.has_table_privilege($1, $2, $3) AS granted`,
          [role, table, privilege],
        );
        if (row.rows[0]?.granted === true) granted[privilege] = ['*'];
      }
      result[table] = granted;
    }
    return result;
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

const column = (client: pg.Client, sql: string, values: unknown[] = []) =>
  client.query<{ value: string }>(sql, values).then(({ rows }) => rows.map(({ value }) => value));
const documents = (client: pg.Client) =>
  column(client, `SELECT id AS value FROM vault.document ORDER BY id`);
const shares = (client: pg.Client) =>
  column(
    client,
    `SELECT document_id || '>' || recipient_id AS value FROM vault.document_recipient ORDER BY 1`,
  );
const links = (client: pg.Client) =>
  column(client, `SELECT inviter_id || '>' || invitee_id AS value FROM account.link ORDER BY 1`);
const recipients = (client: pg.Client) =>
  column(client, `SELECT recipient AS value FROM vault.recipient ORDER BY 1`);
const share = (document: string, documentOwner: string, recipient: string): [string, string[]] => [
  `INSERT INTO vault.document_recipient (document_id, document_owner_id, recipient_id)
   VALUES ($1, $2, $3)`,
  [document, documentOwner, recipient],
];

describe('the documents and account links access matrix (spec 0005, R4)', () => {
  it('forces row-level security on account.link', async () => {
    const forced = await withClient(adminTarget(database), (client) =>
      column(
        client,
        `SELECT c.relname AS value FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'account' AND c.relrowsecurity AND c.relforcerowsecurity`,
      ),
    );
    expect(forced).toEqual(['link']);
  });

  it('gives app_api reads, the inserts each side needs and the updates a document needs', async () => {
    expect(await privileges('app_api')).toEqual({
      account: { USAGE: ['*'] },
      'account.link': {
        SELECT: tables['account.link'],
        INSERT: ['inviter_id', 'invitee_id'],
        DELETE: ['*'],
      },
      'vault.document': {
        SELECT: tables['vault.document'],
        INSERT: ['owner_id', 'type_key', 'size', 'sha256', 'object_key'],
        UPDATE: ['size', 'sha256', 'object_key', 'confirmed_at'],
        DELETE: ['*'],
      },
      'vault.document_recipient': {
        SELECT: tables['vault.document_recipient'],
        INSERT: ['document_id', 'document_owner_id', 'recipient_id'],
        DELETE: ['*'],
      },
      'vault.document_replacement': {
        SELECT: tables['vault.document_replacement'],
        INSERT: ['document_id', 'owner_id', 'size', 'sha256', 'object_key', 'recipients'],
        DELETE: ['*'],
      },
      'vault.discarded_object': {
        SELECT: tables['vault.discarded_object'],
        INSERT: ['object_key', 'owner_id'],
      },
    });
  });

  it('gives app_jobs only reads and deletes', async () => {
    const readAndDelete = (table: keyof typeof tables) => ({
      SELECT: tables[table],
      DELETE: ['*'],
    });
    expect(await privileges('app_jobs')).toEqual({
      account: { USAGE: ['*'] },
      'account.link': readAndDelete('account.link'),
      'vault.document': readAndDelete('vault.document'),
      'vault.document_recipient': readAndDelete('vault.document_recipient'),
      'vault.document_replacement': readAndDelete('vault.document_replacement'),
      'vault.discarded_object': readAndDelete('vault.discarded_object'),
    });
  });

  it.each([
    ...runtimeRoles.filter((role) => !['app_api', 'app_jobs'].includes(role)),
    ...retiredRoles,
  ])('gives %s no access to documents or links', async (role) => {
    expect(await privileges(role)).toEqual({
      account: {},
      'account.link': {},
      'vault.document': {},
      'vault.document_recipient': {},
      'vault.document_replacement': {},
      'vault.discarded_object': {},
    });
  });

  describe('account links', () => {
    it('shows a link to both of its accounts and to nobody else', async () => {
      const link = [`${owner}>${friend}`];
      expect(await as('app_api', owner, links)).toEqual(link);
      expect(await as('app_api', friend, links)).toEqual(link);
      expect(await as('app_api', stranger, links)).toEqual([]);
      expect(await as('app_api', undefined, links)).toEqual([]);
    });

    it('lets only the inviter add a link', async () => {
      expect(
        await as('app_api', stranger, async (client) => {
          await client.query(`INSERT INTO account.link (inviter_id, invitee_id) VALUES ($1, $2)`, [
            stranger,
            owner,
          ]);
          return links(client);
        }),
      ).toEqual([`${stranger}>${owner}`]);
      await expect(
        as('app_api', stranger, (client) =>
          client.query(`INSERT INTO account.link (inviter_id, invitee_id) VALUES ($1, $2)`, [
            owner,
            stranger,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('refuses a link from an account to itself', async () => {
      await expect(
        as('app_api', stranger, (client) =>
          client.query(`INSERT INTO account.link (inviter_id, invitee_id) VALUES ($1, $1)`, [
            stranger,
          ]),
        ),
      ).rejects.toThrow(/link_two_accounts/);
    });

    it.each([
      ['the inviter', owner],
      ['the invitee', friend],
    ])('lets %s remove the link, and a stranger not', async (_party, account) => {
      const remove = (client: pg.Client) =>
        client.query(`DELETE FROM account.link`).then(({ rowCount }) => rowCount);
      expect(await as('app_api', account, remove)).toBe(1);
      expect(await as('app_api', stranger, remove)).toBe(0);
    });

    it.each([
      ['the inviter', owner],
      ['the invitee', friend],
    ])(
      'lets app_jobs erase the link under %s, and nothing under a stranger',
      async (_party, account) => {
        const erase = (client: pg.Client) =>
          client.query(`DELETE FROM account.link`).then(({ rowCount }) => rowCount);
        expect(await as('app_jobs', account, links)).toEqual([`${owner}>${friend}`]);
        expect(await as('app_jobs', account, erase)).toBe(1);
        expect(await as('app_jobs', stranger, erase)).toBe(0);
        expect(await as('app_jobs', undefined, erase)).toBe(0);
      },
    );
  });

  describe('recipients through a link', () => {
    it("shows a linked account's current recipient, both ways, and never a rotated one", async () => {
      expect(await as('app_api', owner, recipients)).toEqual(['age1pq1pppp', 'age1pq1qqqq']);
      expect(await as('app_api', friend, recipients)).toEqual([
        'age1pq1pppp',
        'age1pq1qqqq',
        'age1pq1rrrr',
      ]);
    });

    it('shows a stranger only its own recipient', async () => {
      expect(await as('app_api', stranger, recipients)).toEqual(['age1pq1zzzz']);
    });

    it('stops showing it once the link is removed', async () => {
      expect(
        await as('app_api', owner, async (client) => {
          await client.query(`DELETE FROM account.link`);
          return recipients(client);
        }),
      ).toEqual(['age1pq1qqqq']);
    });

    it("never lets app_jobs read a linked account's recipient", async () => {
      expect(await as('app_jobs', owner, recipients)).toEqual(['age1pq1qqqq']);
    });
  });

  describe('documents', () => {
    it('shows the owner its documents and a recipient only what is shared with it', async () => {
      expect(await as('app_api', owner, documents)).toEqual([shared, unshared].sort());
      expect(await as('app_api', friend, documents)).toEqual([shared]);
      expect(await as('app_api', stranger, documents)).toEqual([strangers]);
      expect(await as('app_api', undefined, documents)).toEqual([]);
    });

    it('shows a share to its owner and its recipient and to nobody else', async () => {
      const row = [`${shared}>${friend}`];
      expect(await as('app_api', owner, shares)).toEqual(row);
      expect(await as('app_api', friend, shares)).toEqual(row);
      expect(await as('app_api', stranger, shares)).toEqual([]);
    });

    it('lets the owner share with a linked account', async () => {
      expect(
        await as('app_api', owner, async (client) => {
          await client.query(...share(unshared, owner, friend));
          return shares(client);
        }),
      ).toEqual([`${shared}>${friend}`, `${unshared}>${friend}`].sort());
    });

    it('refuses a share with an account the owner has no link to', async () => {
      await expect(
        as('app_api', owner, (client) => client.query(...share(unshared, owner, stranger))),
      ).rejects.toThrow(/row-level security/);
    });

    it("refuses a share of another account's document", async () => {
      await expect(
        as('app_api', friend, (client) => client.query(...share(shared, owner, stranger))),
      ).rejects.toThrow(/row-level security/);
      // Naming itself as the owner of someone else's document fails the composite key.
      await expect(
        as('app_api', stranger, async (client) => {
          await client.query(`INSERT INTO account.link (inviter_id, invitee_id) VALUES ($1, $2)`, [
            stranger,
            owner,
          ]);
          await client.query(...share(shared, stranger, owner));
        }),
      ).rejects.toThrow(/document_recipient_document_fkey/);
    });

    it('lets a recipient neither add, remove nor change shares, nor the document', async () => {
      const counts = await as('app_api', friend, async (client) => {
        const counts = [];
        for (const statement of [
          `DELETE FROM vault.document_recipient`,
          `UPDATE vault.document SET confirmed_at = now()`,
          `DELETE FROM vault.document`,
        ]) {
          counts.push((await client.query(statement)).rowCount);
        }
        return counts;
      });
      expect(counts).toEqual([0, 0, 0]);
      await expect(
        as('app_api', friend, (client) => client.query(...share(shared, owner, friend))),
      ).rejects.toThrow(/row-level security/);
    });

    it('refuses sharing a document with its owner', async () => {
      await expect(
        as('app_api', owner, (client) => client.query(...share(unshared, owner, owner))),
      ).rejects.toThrow(/row-level security/);
    });

    it("refuses a document another account owns, and leaves another account's alone", async () => {
      await expect(
        as('app_api', owner, (client) =>
          client.query(
            `INSERT INTO vault.document (owner_id, type_key, size, sha256, object_key)
             VALUES ($1, 'passport', 10, $2, $3)`,
            [stranger, hash, objectKey()],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
      const counts = await as('app_api', owner, async (client) => {
        const updated = await client.query(
          `UPDATE vault.document SET confirmed_at = now() WHERE id = $1`,
          [strangers],
        );
        const deleted = await client.query(`DELETE FROM vault.document WHERE id = $1`, [strangers]);
        return [updated.rowCount, deleted.rowCount];
      });
      expect(counts).toEqual([0, 0]);
    });

    it('refuses a document over 25 MiB, a bad hash, a type key or object key out of shape', async () => {
      const insert = (size: number, sha256: Buffer, typeKey: string, key: string) =>
        as('app_api', owner, (client) =>
          client.query(
            `INSERT INTO vault.document (owner_id, type_key, size, sha256, object_key)
             VALUES ($1, $2, $3, $4, $5)`,
            [owner, typeKey, size, sha256, key],
          ),
        );
      await expect(insert(25 * 1024 * 1024 + 1, hash, 'passport', objectKey())).rejects.toThrow(
        /document_size/,
      );
      await expect(insert(10, Buffer.alloc(31), 'passport', objectKey())).rejects.toThrow(
        /document_sha256_length/,
      );
      await expect(insert(10, hash, 'Passaporte da Ana', objectKey())).rejects.toThrow(
        /document_type_key/,
      );
      await expect(insert(10, hash, 'passport', 'documents/passport.pdf')).rejects.toThrow(
        /document_object_key/,
      );
    });

    it("lets app_jobs erase a recipient's shares, and only its own", async () => {
      const erase = (client: pg.Client) =>
        client.query(`DELETE FROM vault.document_recipient`).then(({ rowCount }) => rowCount);
      expect(await as('app_jobs', owner, erase)).toBe(0);
      expect(await as('app_jobs', stranger, erase)).toBe(0);
      expect(await as('app_jobs', friend, erase)).toBe(1);
    });

    it("lets app_jobs erase the owner's documents, with their shares, and nobody else's", async () => {
      expect(
        await as('app_jobs', owner, async (client) => {
          const erased = await client.query(`DELETE FROM vault.document`);
          return erased.rowCount;
        }),
      ).toBe(2);
      expect(
        await withClient(adminTarget(database), async (client) => {
          await client.query('BEGIN');
          try {
            await client.query(`SET LOCAL ROLE app_jobs`);
            await client.query(`SELECT pg_catalog.set_config('app.account_id', $1, true)`, [owner]);
            await client.query(`DELETE FROM vault.document`);
            await client.query(`RESET ROLE`);
            return await shares(client);
          } finally {
            await client.query('ROLLBACK');
          }
        }),
      ).toEqual([]);
      expect(await as('app_jobs', friend, documents)).toEqual([]);
      expect(await as('app_jobs', stranger, documents)).toEqual([strangers]);
    });
  });

  describe('replacements and discarded objects', () => {
    const replace = (documentId: string, documentOwner: string, recipientIds: string[]) =>
      [
        `INSERT INTO vault.document_replacement (document_id, owner_id, size, sha256, object_key, recipients)
         VALUES ($1, $2, 10, $3, $4, $5)`,
        [documentId, documentOwner, hash, objectKey(), recipientIds],
      ] as [string, unknown[]];
    const replacements = (client: pg.Client) =>
      column(client, `SELECT document_id AS value FROM vault.document_replacement ORDER BY 1`);
    const discard = (account: string) =>
      [
        `INSERT INTO vault.discarded_object (object_key, owner_id) VALUES ($1, $2)`,
        [objectKey(), account],
      ] as [string, unknown[]];

    it('lets only the owner approve a replacement, seen by nobody else', async () => {
      expect(
        await as('app_api', owner, async (client) => {
          await client.query(...replace(shared, owner, [friend]));
          return replacements(client);
        }),
      ).toEqual([shared]);
      await expect(
        as('app_api', friend, (client) => client.query(...replace(shared, owner, []))),
      ).rejects.toThrow(/row-level security/);
      await expect(
        as('app_api', stranger, (client) => client.query(...replace(shared, stranger, []))),
      ).rejects.toThrow(/document_replacement_document_fkey/);
    });

    it('refuses a replacement encrypted to its owner, or to more than 16 accounts', async () => {
      await expect(
        as('app_api', owner, (client) => client.query(...replace(shared, owner, [owner]))),
      ).rejects.toThrow(/document_replacement_recipients/);
      const many = Array.from({ length: 17 }, () => randomUUID());
      await expect(
        as('app_api', owner, (client) => client.query(...replace(shared, owner, many))),
      ).rejects.toThrow(/document_replacement_recipients/);
    });

    it("hides a replacement from others, and lets app_jobs erase only the owner's", async () => {
      const seen = await as('app_api', owner, async (client) => {
        await client.query(...replace(shared, owner, []));
        await client.query(`SELECT pg_catalog.set_config('app.account_id', $1, true)`, [friend]);
        const friendSees = await replacements(client);
        const friendDeletes = (await client.query(`DELETE FROM vault.document_replacement`))
          .rowCount;
        return { friendSees, friendDeletes };
      });
      expect(seen).toEqual({ friendSees: [], friendDeletes: 0 });
    });

    it("lets the owner change a document's object, and nobody else", async () => {
      const update = (client: pg.Client) =>
        client
          .query(`UPDATE vault.document SET object_key = $2, size = 11 WHERE id = $1`, [
            shared,
            objectKey(),
          ])
          .then(({ rowCount }) => rowCount);
      expect(await as('app_api', owner, update)).toBe(1);
      expect(await as('app_api', friend, update)).toBe(0);
      expect(await as('app_api', stranger, update)).toBe(0);
    });

    it('lets app_api record and read only its own discarded objects, never delete them', async () => {
      const seen = await as('app_api', owner, async (client) => {
        await client.query(...discard(owner));
        const own = await column(
          client,
          `SELECT owner_id::text AS value FROM vault.discarded_object`,
        );
        await client.query(`SELECT pg_catalog.set_config('app.account_id', $1, true)`, [stranger]);
        const others = await column(
          client,
          `SELECT owner_id::text AS value FROM vault.discarded_object`,
        );
        return { own, others };
      });
      expect(seen).toEqual({ own: [owner], others: [] });
      await expect(
        as('app_api', owner, (client) => client.query(...discard(stranger))),
      ).rejects.toThrow(/row-level security/);
      await expect(
        as('app_api', owner, (client) => client.query(`DELETE FROM vault.discarded_object`)),
      ).rejects.toThrow(/permission denied/);
    });

    it("lets app_jobs read and erase the owner's discarded objects, and nobody else's", async () => {
      const keys = await withClient(adminTarget(database), async (client) => {
        await client.query('BEGIN');
        try {
          await client.query(...discard(owner));
          await client.query(...discard(stranger));
          await client.query(`SET LOCAL ROLE app_jobs`);
          await client.query(`SELECT pg_catalog.set_config('app.account_id', $1, true)`, [owner]);
          const seen = await column(
            client,
            `SELECT owner_id::text AS value FROM vault.discarded_object`,
          );
          const erased = (await client.query(`DELETE FROM vault.discarded_object`)).rowCount;
          return { seen, erased };
        } finally {
          await client.query('ROLLBACK');
        }
      });
      expect(keys).toEqual({ seen: [owner], erased: 1 });
    });
  });
});
