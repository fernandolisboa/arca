import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { databaseServer } from '../servers.js';

/** A synthetic account with one passkey, written as the admin of the disposable server. */
export async function seedAccount({
  credentialId,
  publicKey,
}: {
  readonly credentialId: string;
  readonly publicKey: string;
}): Promise<{ userId: string; email: string }> {
  const password = process.env['ARCA_TEST_DB_ADMIN_PASSWORD'] ?? '';
  if (password === '') throw new Error('ARCA_TEST_DB_ADMIN_PASSWORD is not set');
  const client = new pg.Client({
    host: databaseServer.database.host,
    port: databaseServer.database.port,
    database: databaseServer.database.name,
    user: process.env['ARCA_TEST_DB_ADMIN_USER'] ?? 'postgres',
    password,
  });
  const userId = randomUUID();
  const email = `e2e-${userId}@example.com`;
  await client.connect();
  try {
    await client.query(
      `INSERT INTO auth."user" (id, name, email, email_verified) VALUES ($1, '', $2, true)`,
      [userId, email],
    );
    await client.query(
      `INSERT INTO auth.passkey (public_key, user_id, credential_id, counter, device_type, backed_up)
       VALUES ($1, $2, $3, 0, 'multiDevice', true)`,
      [publicKey, userId, credentialId],
    );
  } finally {
    await client.end();
  }
  return { userId, email };
}
