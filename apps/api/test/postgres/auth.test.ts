import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeSignature } from 'better-auth/crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createAuth, type Auth } from '../../src/auth/auth.js';
import { authService } from '../../src/auth/service.js';
import { authDatabase } from '../../src/database.js';
import type { Logger } from '../../src/logger.js';

// Better Auth on the real auth migrations and the app_auth pool, against a disposable Postgres
// server (spec 0003, R1). Synthetic addresses on reserved domains only.
const host = process.env['ARCA_TEST_DB_HOST'] ?? '127.0.0.1';
const port = Number(process.env['ARCA_TEST_DB_PORT'] ?? '5432');
const adminUser = process.env['ARCA_TEST_DB_ADMIN_USER'] ?? 'postgres';
const adminPassword = process.env['ARCA_TEST_DB_ADMIN_PASSWORD'] ?? '';
if (adminPassword === '') throw new Error('ARCA_TEST_DB_ADMIN_PASSWORD is not set');

const database = `arca_auth_${randomBytes(6).toString('hex')}`;
const authPassword = randomBytes(24).toString('base64url');
const secret = randomBytes(32).toString('base64url');
const origin = 'http://localhost:3000';
const migrationsDir = join(import.meta.dirname, '../../../../packages/db/migrations');
const logger: Logger = { info: () => undefined, error: () => undefined };

async function asAdmin<T>(name: string, use: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    host,
    port,
    database: name,
    user: adminUser,
    password: adminPassword,
    ssl: false,
  });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

let auth: Auth;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  await asAdmin('postgres', async (client) => {
    await client.query(`CREATE DATABASE ${database}`);
    const exists = await client.query("SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_auth'");
    await client.query(
      `${exists.rowCount === 0 ? 'CREATE' : 'ALTER'} ROLE app_auth LOGIN PASSWORD '${authPassword}'`,
    );
  });
  // The runner's checks are tested in tooling/scripts; here the migrations only need to exist.
  await asAdmin(database, async (client) => {
    for (const name of (await readdir(migrationsDir)).sort()) {
      const sql = await readFile(join(migrationsDir, name, 'migration.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) await client.query(statement);
    }
  });
  const pool = authDatabase({ host, port, database, ssl: false }, authPassword, logger);
  await pool.ready();
  close = pool.close;
  auth = createAuth({ db: pool.db, secret, origin, logger });
  app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger,
    auth: authService(auth),
  });
});

afterAll(async () => {
  await close();
  await asAdmin('postgres', (client) => client.query(`DROP DATABASE ${database} WITH (FORCE)`));
});

/** A signed session cookie, as Better Auth sets it after a passkey sign-in. */
async function signedIn(email: string): Promise<{ cookie: string; userId: string }> {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    { email, name: '', emailVerified: true },
    { method: 'test' },
  );
  const session = await context.internalAdapter.createSession(user.id);
  const value = encodeURIComponent(
    `${session.token}.${await makeSignature(session.token, secret)}`,
  );
  return { cookie: `${context.authCookies.sessionToken.name}=${value}`, userId: user.id };
}

describe('Better Auth on the app_auth pool', () => {
  it('returns the session and stores no network details', async () => {
    const { cookie, userId } = await signedIn('owner@example.com');
    const response = await app.request('/v1/session', { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accountId: userId,
      email: 'owner@example.com',
      device: { browser: 'other', os: 'other' },
    });
    const stored = await asAdmin(database, async (client) => {
      const sessions = await client.query(
        'SELECT ip_address, user_agent FROM auth.session WHERE user_id = $1',
        [userId],
      );
      const users = await client.query<{ signedIn: boolean }>(
        'SELECT last_sign_in_at IS NOT NULL AS "signedIn" FROM auth.user WHERE id = $1',
        [userId],
      );
      return { sessions: sessions.rows, users: users.rows };
    });
    expect(stored).toEqual({
      sessions: [{ ip_address: null, user_agent: null }],
      users: [{ signedIn: true }],
    });
  });

  it('signs out through the allow-listed endpoint', async () => {
    const { cookie, userId } = await signedIn('member@example.org');
    const signOut = await app.request('/v1/auth/sign-out', {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(signOut.status).toBe(200);
    expect(await signOut.json()).toEqual({ success: true });
    expect((await app.request('/v1/session', { headers: { cookie } })).status).toBe(401);
    const remaining = await asAdmin(database, (client) =>
      client.query('SELECT FROM auth.session WHERE user_id = $1', [userId]),
    );
    expect(remaining.rowCount).toBe(0);
  });

  it('refuses a session cookie with a bad signature', async () => {
    const { cookie } = await signedIn('other@example.com');
    const forged = cookie.replace(/\.[^.]*$/, '.forged');
    expect((await app.request('/v1/session', { headers: { cookie: forged } })).status).toBe(401);
  });
});
