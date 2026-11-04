import { randomBytes, randomUUID } from 'node:crypto';
import { registry, type RegistryEntry } from '@arca/db/registry';
import type { AuthTestDatabase } from './auth-database.js';

// Synthetic accounts with rows in every registry table (spec 0004, R7 to R9).

export interface Seeded {
  readonly accountId: string;
  readonly email: string;
  readonly credentialId: string;
  readonly codeHash: Buffer;
}

const bytes = (size: number) => randomBytes(size);

/** An account with at least one row in every table of the registry. */
export async function seeded(testDatabase: AuthTestDatabase): Promise<Seeded> {
  const accountId = randomUUID();
  const sessionId = randomUUID();
  const email = `person-${randomBytes(6).toString('hex')}@example.com`;
  const credentialId = randomBytes(16).toString('base64url');
  const codeHash = bytes(32);
  await testDatabase.asAdmin(async (client) => {
    const insert = (statement: string, values: unknown[]) => client.query(statement, values);
    await insert(`INSERT INTO auth.user (id, name, email) VALUES ($1, '', $2)`, [accountId, email]);
    await insert(
      `INSERT INTO auth.account (account_id, provider_id, user_id) VALUES ($1, 'passkey', $2)`,
      [accountId, accountId],
    );
    await insert(
      `INSERT INTO auth.passkey (public_key, user_id, credential_id, counter, device_type, backed_up)
       VALUES ('key', $1, $2, 0, 'multiDevice', true)`,
      [accountId, credentialId],
    );
    await insert(
      `INSERT INTO auth.passkey_activation (credential_id, active_from) VALUES ($1, now())`,
      [credentialId],
    );
    await insert(
      `INSERT INTO auth.passkey_capability (credential_id, prf_enabled) VALUES ($1, true)`,
      [credentialId],
    );
    await insert(
      `INSERT INTO auth.passkey_client (credential_id, browser, os) VALUES ($1, 'firefox', 'linux')`,
      [credentialId],
    );
    await insert(
      `INSERT INTO auth.session (id, expires_at, token, user_id, device_browser, device_os, credential_id)
       VALUES ($1, now() + interval '1 day', $2, $3, 'firefox', 'linux', $4)`,
      [sessionId, randomBytes(16).toString('hex'), accountId, credentialId],
    );
    await insert(
      `INSERT INTO auth.passkey_challenge (account_id, session_id, challenge) VALUES ($1, $2, $3)`,
      [accountId, sessionId, bytes(32)],
    );
    await insert(
      `INSERT INTO auth.recovery_code (account_id, salt, code_hash) VALUES ($1, $2, $3)`,
      [accountId, bytes(16), codeHash],
    );
    await insert(`INSERT INTO auth.recovery_link (token_hash, account_id) VALUES ($1, $2)`, [
      bytes(32),
      accountId,
    ]);
    await insert(`INSERT INTO auth.recovery_lock (account_id, failures) VALUES ($1, 1)`, [
      accountId,
    ]);
    await insert(
      `INSERT INTO auth.step_up (account_id, session_id, credential_id, purpose, subject_hash, nonce,
                                 authenticator_data, client_data_json, signature)
       VALUES ($1, $2, $3, 'data_export', $4, $5, $6, $7, $8)`,
      [accountId, sessionId, credentialId, bytes(32), bytes(32), bytes(37), bytes(64), bytes(64)],
    );
    await insert(
      `INSERT INTO auth.step_up_challenge (account_id, session_id, purpose, subject_hash, nonce)
       VALUES ($1, $2, 'data_export', $3, $4)`,
      [accountId, sessionId, bytes(32), bytes(32)],
    );
    await insert(`INSERT INTO auth.invite (inviter_id, email, token_hash) VALUES ($1, $2, $3)`, [
      accountId,
      `invited-${randomBytes(6).toString('hex')}@example.com`,
      bytes(32),
    ]);
    const recipientId = randomUUID();
    await insert(`INSERT INTO vault.recipient (id, account_id, recipient) VALUES ($1, $2, $3)`, [
      recipientId,
      accountId,
      'age1pq1qqqq',
    ]);
    await insert(
      `INSERT INTO vault.envelope (account_id, recipient_id, kind, credential_id, ciphertext)
       VALUES ($1, $2, 'passkey_prf', $3, $4), ($1, $2, 'recovery', NULL, $4)`,
      [accountId, recipientId, credentialId, bytes(256)],
    );
    await insert(
      `INSERT INTO vault.sharing_state (account_id, version, state, tag) VALUES ($1, 1, $2, $3)`,
      [accountId, Buffer.from('{}'), bytes(32)],
    );
    const channelId = randomUUID();
    const messageId = randomUUID();
    await insert(
      `INSERT INTO notification.channel (id, account_id, kind, endpoint, p256dh, auth_secret, browser, os)
       VALUES ($1, $2, 'web_push', 'https://push.example.com/send/1', $3, $4, 'firefox', 'linux')`,
      [channelId, accountId, bytes(65).toString('base64url'), bytes(16).toString('base64url')],
    );
    await insert(
      `INSERT INTO notification.message (id, account_id, code) VALUES ($1, $2, 'passkey_added')`,
      [messageId, accountId],
    );
    await insert(
      `INSERT INTO notification.delivery (account_id, message_id, channel_id) VALUES ($1, $2, $3)`,
      [accountId, messageId, channelId],
    );
    await insert(
      `INSERT INTO audit.event (subject_account_id, actor_account_id, code) VALUES ($1, $2, 'sign_in')`,
      [accountId, accountId],
    );
  });
  return { accountId, email, credentialId, codeHash };
}

/** Counts the account's rows in one registry table, joining a child to its parent. */
export function ownedCountQuery(entry: RegistryEntry): string {
  const { owner } = entry;
  if ('column' in owner) {
    return `SELECT count(*)::int AS n FROM ${entry.table} WHERE ${owner.column} = $1`;
  }
  const parent = registry.entries.find(({ table }) => table === owner.parent);
  const parentOwner = parent !== undefined && 'column' in parent.owner ? parent.owner.column : '';
  return `SELECT count(*)::int AS n FROM ${entry.table} t JOIN ${owner.parent} p
            ON t.${owner.columns[0] ?? ''} = p.${owner.parentColumns[0] ?? ''}
          WHERE p.${parentOwner} = $1`;
}

/** The account's rows per registry table, counted as the server's admin. */
export async function ownedCounts(
  testDatabase: AuthTestDatabase,
  accountId: string,
): Promise<Record<string, number>> {
  return testDatabase.asAdmin(async (client) => {
    const counts: Record<string, number> = {};
    for (const entry of registry.entries) {
      const result = await client.query<{ n: number }>(ownedCountQuery(entry), [accountId]);
      counts[entry.table] = result.rows[0]?.n ?? 0;
    }
    return counts;
  });
}
