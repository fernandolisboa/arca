import { randomBytes, randomUUID } from 'node:crypto';
import type { SignedIn } from '../../src/auth/service.js';
import { softwarePasskey, type SoftwarePasskey } from '../software-passkey.js';
import type { AuthTestDatabase } from './auth-database.js';

export interface Key {
  readonly id: string;
  readonly passkey: SoftwarePasskey;
}

export interface Account {
  readonly accountId: string;
  readonly email: string;
  readonly keys: readonly [Key, ...Key[]];
}

/** Synthetic accounts, passkeys and sessions, written as Better Auth and its plugin write them. */
export function accountFixtures(testDatabase: AuthTestDatabase, rpId: string) {
  const { asAdmin } = testDatabase;

  /** An account with this many passkeys, oldest first. */
  async function account(passkeys = 2): Promise<Account> {
    const accountId = randomUUID();
    const email = `${accountId}@example.com`;
    const keys: Key[] = [];
    await asAdmin(async (client) => {
      await client.query(`INSERT INTO auth.user (id, name, email) VALUES ($1, '', $2)`, [
        accountId,
        email,
      ]);
      for (let index = 0; index < passkeys; index += 1) {
        const passkey = softwarePasskey(rpId);
        const id = randomUUID();
        await client.query(
          `INSERT INTO auth.passkey
             (id, public_key, user_id, credential_id, counter, device_type, backed_up, created_at)
           VALUES ($1, $2, $3, $4, 0, 'multiDevice', true, now() - make_interval(days => $5))`,
          [id, passkey.publicKey, accountId, passkey.credentialId, passkeys - index],
        );
        await client.query(
          `INSERT INTO auth.passkey_client (credential_id, browser, os) VALUES ($1, 'firefox', 'linux')`,
          [passkey.credentialId],
        );
        keys.push({ id, passkey });
      }
    });
    return { accountId, email, keys: keys as [Key, ...Key[]] };
  }

  /** A session the key signed in, `age` old and last slid `idle` ago. */
  async function session(
    owner: Account,
    key: Key,
    { age = '1 hour', idle = '1 minute', expiresIn = '1 day' } = {},
  ): Promise<SignedIn> {
    const sessionId = randomUUID();
    await asAdmin((client) =>
      client.query(
        `INSERT INTO auth.session
           (id, expires_at, token, user_id, device_browser, device_os, credential_id, created_at, updated_at)
         VALUES ($1, now() + $2::interval, $3, $4, 'chrome', 'android', $5,
                 now() - $6::interval, now() - $7::interval)`,
        [
          sessionId,
          expiresIn,
          randomBytes(16).toString('hex'),
          owner.accountId,
          key.passkey.credentialId,
          age,
          idle,
        ],
      ),
    );
    return { accountId: owner.accountId, sessionId };
  }

  const count = (sql: string, values: readonly unknown[]): Promise<number> =>
    asAdmin(
      async (client) =>
        (await client.query<{ n: number }>(sql, [...values])).rows[0]?.n ?? Number.NaN,
    );

  const sessionsOf = (owner: Account) =>
    asAdmin(async (client) =>
      (
        await client.query<{ id: string }>(
          'SELECT id FROM auth.session WHERE user_id = $1 ORDER BY id',
          [owner.accountId],
        )
      ).rows.map(({ id }) => id),
    );

  const events = (owner: Account, codes: readonly string[]) =>
    asAdmin(
      async (client) =>
        (
          await client.query<{ code: string; actor: string | null; details: unknown }>(
            `SELECT code, actor_account_id AS actor, details FROM audit.event
              WHERE subject_account_id = $1 AND code = ANY($2)
              ORDER BY time, id`,
            [owner.accountId, codes],
          )
        ).rows,
    );

  const pendingOf = (owner: Account) =>
    asAdmin(
      async (client) =>
        (
          await client.query<{ id: string; credentialId: string; recovery: boolean }>(
            `SELECT p.id, p.credential_id AS "credentialId", a.recovery FROM auth.passkey p
               JOIN auth.passkey_activation a ON a.credential_id = p.credential_id
              WHERE p.user_id = $1`,
            [owner.accountId],
          )
        ).rows,
    );

  /** Ends the 24-hour wait of every pending passkey of the account. */
  const waitOver = (owner: Account) =>
    asAdmin((client) =>
      client.query(
        `UPDATE auth.passkey_activation SET active_from = now() - interval '1 second'
          WHERE credential_id IN (SELECT credential_id FROM auth.passkey WHERE user_id = $1)`,
        [owner.accountId],
      ),
    );

  return { account, session, count, sessionsOf, events, pendingOf, waitOver };
}
