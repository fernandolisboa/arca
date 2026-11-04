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

async function asAdmin(work: (client: pg.Client) => Promise<void>): Promise<void> {
  const client = adminClient();
  await client.connect();
  try {
    await work(client);
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
