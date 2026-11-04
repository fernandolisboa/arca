import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { databaseServer } from '../servers.js';

/** The disposable server, as its admin; every connection field is explicit. */
function adminClient(): pg.Client {
  const password = process.env['ARCA_TEST_DB_ADMIN_PASSWORD'] ?? '';
  if (password === '') throw new Error('ARCA_TEST_DB_ADMIN_PASSWORD is not set');
  return new pg.Client({
    host: databaseServer.database.host,
    port: databaseServer.database.port,
    database: databaseServer.database.name,
    user: process.env['ARCA_TEST_DB_ADMIN_USER'] ?? 'postgres',
    password,
  });
}

async function asAdmin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = adminClient();
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** A synthetic account with one passkey. */
export async function seedAccount({
  credentialId,
  publicKey,
}: {
  readonly credentialId: string;
  readonly publicKey: string;
}): Promise<{ userId: string; email: string }> {
  const userId = randomUUID();
  const email = `e2e-${userId}@example.com`;
  await asAdmin(async (client) => {
    await client.query(
      `INSERT INTO auth."user" (id, name, email, email_verified) VALUES ($1, '', $2, true)`,
      [userId, email],
    );
    await client.query(
      `INSERT INTO auth.passkey (public_key, user_id, credential_id, counter, device_type, backed_up)
       VALUES ($1, $2, $3, 0, 'multiDevice', true)`,
      [publicKey, userId, credentialId],
    );
  });
  return { userId, email };
}

/**
 * A local server counts every request as one client, so repeated local runs would reach the
 * per-IP limits; each run starts from fresh counters.
 */
export async function resetRateLimits(): Promise<void> {
  await asAdmin(async (client) => {
    await client.query('DELETE FROM auth.rate_limit');
  });
}

/**
 * The first account is created once per database, so the enrollment tests start from one with no
 * account, no spent enrollment code and no pending link, and run before any test seeds an account.
 */
export async function resetEnrollment(): Promise<void> {
  await asAdmin(async (client) => {
    await client.query('DELETE FROM auth."user"');
    await client.query('DELETE FROM auth.setup');
    await client.query('DELETE FROM auth.registration_context');
    await client.query('DELETE FROM auth.outbox');
    await client.query('DELETE FROM auth.rate_limit');
  });
}

/** The newest message the outbox holds for an address. */
export async function latestEmailTo(recipient: string): Promise<string | undefined> {
  return asAdmin(async (client) => {
    const { rows } = await client.query<{ body: string }>(
      'SELECT body FROM auth.outbox WHERE recipient = $1 ORDER BY created_at DESC LIMIT 1',
      [recipient],
    );
    return rows[0]?.body;
  });
}

/** What the database recorded about an account's passkeys and recovery kit. */
export async function enrolledAccount(email: string) {
  return asAdmin(async (client) => {
    const { rows } = await client.query<{
      confirmed: boolean;
      prf_enabled: boolean | null;
      kit_saved: boolean | null;
    }>(
      `SELECT u.confirmed_at IS NOT NULL AS confirmed, c.prf_enabled,
              k.confirmed_at IS NOT NULL AS kit_saved
         FROM auth."user" u
         LEFT JOIN auth.passkey p ON p.user_id = u.id
         LEFT JOIN auth.passkey_capability c ON c.credential_id = p.credential_id
         LEFT JOIN auth.recovery_code k ON k.account_id = u.id
        WHERE u.email = $1`,
      [email],
    );
    return rows;
  });
}

/** Erases every account, as an erasure would (spec 0004). */
export async function deleteAccounts(): Promise<void> {
  await asAdmin(async (client) => {
    await client.query('DELETE FROM auth."user"');
  });
}
