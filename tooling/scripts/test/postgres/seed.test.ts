import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/runner.ts';
import { readSeedAccounts, seed, type SeedAccount } from '../../src/db/seed.ts';
import {
  adminTarget,
  containerPolicy,
  dropDatabase,
  freshDatabase,
  migratorTarget,
  realMigrations,
  roleTarget,
  setComment,
  withClient,
} from './support.ts';

const seedFile = join(import.meta.dirname, '../../../../packages/db/seed/accounts.json');

let database: string;
let accounts: SeedAccount[];
beforeEach(async () => {
  database = await freshDatabase();
  await migrate(migratorTarget(database), await realMigrations(), await containerPolicy());
  accounts = await readSeedAccounts(seedFile);
});
afterEach(async () => {
  await dropDatabase(database);
});

async function rows(): Promise<unknown[]> {
  return withClient(adminTarget(database), async (client) => {
    const users = await client.query<Record<string, unknown>>(
      `SELECT * FROM auth."user" ORDER BY id`,
    );
    const passkeys = await client.query<Record<string, unknown>>(
      `SELECT * FROM auth.passkey ORDER BY id`,
    );
    return [...users.rows, ...passkeys.rows];
  });
}

describe('the synthetic seed (spec 0004, R2)', () => {
  it('writes each account and passkey as app_auth, and a second run leaves the same rows', async () => {
    const target = roleTarget(database, 'app_auth');
    await seed(target, accounts, undefined);
    const first = await rows();
    expect(first).toHaveLength(accounts.length * 2);
    await seed(target, accounts, undefined);
    expect(await rows()).toEqual(first);
  });

  it('refuses a production run and writes nothing', async () => {
    await expect(seed(roleTarget(database, 'app_auth'), accounts, 'production')).rejects.toThrow(
      'seed_refused_in_production',
    );
    expect(await rows()).toEqual([]);
  });

  it('seeds a preview whose database has the endpoint mark and no lineage mark', async () => {
    await setComment(database, 'arca production endpoint: ep-production');
    await seed(roleTarget(database, 'app_auth'), accounts, 'preview');
    expect(await rows()).toHaveLength(accounts.length * 2);
  });

  it('refuses a preview on a fork of production and writes nothing', async () => {
    await setComment(database, 'arca production endpoint: ep-production');
    await withClient(adminTarget(database), (client) =>
      client.query(`COMMENT ON SCHEMA arca_migrations IS 'arca lineage: production'`),
    );
    await expect(seed(roleTarget(database, 'app_auth'), accounts, 'preview')).rejects.toThrow(
      'preview_forked_from_production',
    );
    expect(await rows()).toEqual([]);
  });

  it('refuses a preview that reaches the production endpoint itself', async () => {
    const target = roleTarget(database, 'app_auth');
    await setComment(database, `arca production endpoint: ${target.host.split('.')[0] ?? ''}`);
    await expect(seed(target, accounts, 'preview')).rejects.toThrow(
      'a preview build reaches the production database',
    );
    expect(await rows()).toEqual([]);
  });
});
