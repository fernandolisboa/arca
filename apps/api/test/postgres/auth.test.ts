import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeSignature } from 'better-auth/crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createAuth, type Auth } from '../../src/auth/auth.js';
import { authService } from '../../src/auth/service.js';
import { auditLog, auditReader } from '../../src/audit/log.js';
import { noticeNewSignIn, recordPasskeyClient } from '../../src/auth/sign-in-notice.js';
import type { Notice } from '../../src/email/notices.js';
import { outboxSender, readOutbox } from '../../src/email/outbox.js';
import { apiDatabase, auditDatabase, authDatabase } from '../../src/database.js';
import type { Database } from '@arca/db';
import type { Logger } from '../../src/logger.js';

// Better Auth on the real auth migrations and the app_auth pool, against a disposable Postgres
// server (spec 0003, R1). Synthetic addresses on reserved domains only.
const host = process.env['ARCA_TEST_DB_HOST'] ?? '127.0.0.1';
const port = Number(process.env['ARCA_TEST_DB_PORT'] ?? '5432');
const adminUser = process.env['ARCA_TEST_DB_ADMIN_USER'] ?? 'postgres';
const adminPassword = process.env['ARCA_TEST_DB_ADMIN_PASSWORD'] ?? '';
if (adminPassword === '') throw new Error('ARCA_TEST_DB_ADMIN_PASSWORD is not set');

const database = `arca_auth_${randomBytes(6).toString('hex')}`;
const passwords = {
  app_auth: randomBytes(24).toString('base64url'),
  app_audit: randomBytes(24).toString('base64url'),
  app_api: randomBytes(24).toString('base64url'),
};
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
let authDb: Database;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  await asAdmin('postgres', async (client) => {
    await client.query(`CREATE DATABASE ${database}`);
    for (const [role, password] of Object.entries(passwords)) {
      const exists = await client.query('SELECT FROM pg_catalog.pg_roles WHERE rolname = $1', [
        role,
      ]);
      await client.query(
        `${exists.rowCount === 0 ? 'CREATE' : 'ALTER'} ROLE ${role} LOGIN PASSWORD '${password}'`,
      );
    }
  });
  // The runner's checks are tested in tooling/scripts; here the migrations only need to exist.
  await asAdmin(database, async (client) => {
    for (const name of (await readdir(migrationsDir)).sort()) {
      const sql = await readFile(join(migrationsDir, name, 'migration.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) await client.query(statement);
    }
  });
  const target = { host, port, database, ssl: false };
  const pools = [
    authDatabase(target, passwords.app_auth, logger),
    auditDatabase(target, passwords.app_audit, logger),
    apiDatabase(target, passwords.app_api, logger),
  ] as const;
  await Promise.all(pools.map((pool) => pool.ready()));
  close = async () => {
    await Promise.all(pools.map((pool) => pool.close()));
  };
  const [authPool, auditPool, apiPool] = pools;
  authDb = authPool.db;
  auth = createAuth({ db: authPool.db, secret, origin, logger, audit: auditLog(auditPool.db) });
  app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger,
    auth: authService(auth),
    audit: auditReader(apiPool.db),
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

  it('reads the session without sliding its stored expiry', async () => {
    const { cookie, userId } = await signedIn('reader@example.com');
    // Five days left of seven: past Better Auth's one-day update age, so a refresh would move it.
    const aged = await asAdmin(database, async (client) => {
      const result = await client.query<{ expiresAt: Date }>(
        `UPDATE auth.session SET expires_at = now() + interval '5 days' WHERE user_id = $1
         RETURNING expires_at AS "expiresAt"`,
        [userId],
      );
      return result.rows[0]?.expiresAt;
    });
    expect((await app.request('/v1/session', { headers: { cookie } })).status).toBe(200);
    const after = await asAdmin(database, (client) =>
      client.query<{ expiresAt: Date }>(
        'SELECT expires_at AS "expiresAt" FROM auth.session WHERE user_id = $1',
        [userId],
      ),
    );
    expect(after.rows[0]?.expiresAt).toEqual(aged);
  });

  it('refuses an expired session', async () => {
    const { cookie, userId } = await signedIn('expired@example.org');
    await asAdmin(database, (client) =>
      client.query(
        "UPDATE auth.session SET expires_at = now() - interval '1 minute' WHERE user_id = $1",
        [userId],
      ),
    );
    expect((await app.request('/v1/session', { headers: { cookie } })).status).toBe(401);
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

  it('records the sign-in and shows the account only its own events', async () => {
    const { cookie, userId } = await signedIn('audited@example.com');
    await signedIn('stranger@example.org');
    const response = await app.request('/v1/audit/events', { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { events: { code: string }[]; next: unknown };
    expect(body).toMatchObject({
      events: [
        {
          code: 'sign_in',
          actorAccountId: userId,
          details: { browser: 'other', os: 'other' },
        },
      ],
      next: null,
    });
  });

  it('pages through the events with a cursor', async () => {
    const { cookie, userId } = await signedIn('pager@example.com');
    const context = await auth.$context;
    await context.internalAdapter.createSession(userId);
    await context.internalAdapter.createSession(userId);
    const page = async (query: string) =>
      (await (await app.request(`/v1/audit/events${query}`, { headers: { cookie } })).json()) as {
        events: { id: string }[];
        next: string | null;
      };
    const first = await page('?limit=2');
    expect(first.events).toHaveLength(2);
    expect(first.next).toBe(first.events[1]?.id);
    const second = await page(`?limit=2&before=${String(first.next)}`);
    expect(second.events).toHaveLength(1);
    expect(second.next).toBeNull();
    const ids = [...first.events, ...second.events].map((event) => event.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('fails the sign-in and leaves no session when the event cannot be recorded', async () => {
    const { userId } = await signedIn('unrecorded@example.com');
    const failing = createAuth({
      db: authDb,
      secret,
      origin,
      logger,
      audit: { record: () => Promise.reject(new Error('audit unavailable')) },
    });
    const context = await failing.$context;
    await expect(context.internalAdapter.createSession(userId)).rejects.toThrow(
      'audit unavailable',
    );
    const sessions = await asAdmin(database, (client) =>
      client.query('SELECT FROM auth.session WHERE user_id = $1', [userId]),
    );
    expect(sessions.rowCount).toBe(1);
  });

  it('answers 401 to the audit events without a session', async () => {
    expect((await app.request('/v1/audit/events')).status).toBe(401);
  });

  it('refuses a session cookie with a bad signature', async () => {
    const { cookie } = await signedIn('other@example.com');
    const forged = cookie.replace(/\.[^.]*$/, '.forged');
    expect((await app.request('/v1/session', { headers: { cookie: forged } })).status).toBe(401);
  });
});

/** A passkey row for a synthetic account; the credential ID is synthetic too. */
async function withPasskey(email: string): Promise<string> {
  const { userId } = await signedIn(email);
  const credentialId = `credential-${randomBytes(8).toString('hex')}`;
  await asAdmin(database, (client) =>
    client.query(
      `INSERT INTO auth.passkey (public_key, user_id, credential_id, counter, device_type, backed_up)
       VALUES ('synthetic', $1, $2, 0, 'multiDevice', true)`,
      [userId, credentialId],
    ),
  );
  return credentialId;
}

describe('new-sign-in notices (spec 0003, R7)', () => {
  it('sends one notice for a family not seen before for that passkey, and none for a repeat', async () => {
    const credentialId = await withPasskey('notices@example.com');
    const sent: Notice[] = [];
    const deps = {
      db: authDb,
      notices: { send: (notice: Notice) => Promise.resolve(void sent.push(notice)) },
    };
    const signIn = (browser: 'firefox' | 'chrome', os: 'linux' | 'android') =>
      noticeNewSignIn(deps, {
        credentialId,
        device: { browser, os },
        email: 'notices@example.com',
        at: new Date(),
      });
    await signIn('firefox', 'linux'); // the registration's families: no notice
    await signIn('firefox', 'linux');
    expect(sent).toEqual([]);
    await signIn('chrome', 'linux');
    await signIn('chrome', 'linux');
    await signIn('firefox', 'android');
    expect(sent.map((notice) => notice.kind === 'new_sign_in' && notice.device)).toEqual([
      { browser: 'chrome', os: 'linux' },
      { browser: 'firefox', os: 'android' },
    ]);
  });

  it('forgets the families when the passkey is deleted', async () => {
    const credentialId = await withPasskey('forget@example.org');
    await recordPasskeyClient(authDb, credentialId, { browser: 'safari', os: 'ios' });
    const remaining = await asAdmin(database, async (client) => {
      await client.query('DELETE FROM auth.passkey WHERE credential_id = $1', [credentialId]);
      return client.query('SELECT FROM auth.passkey_client WHERE credential_id = $1', [
        credentialId,
      ]);
    });
    expect(remaining.rowCount).toBe(0);
  });
});

describe('the outbox (spec 0003, R8)', () => {
  it('keeps sent messages for the preview page and drops them after 7 days', async () => {
    const outbox = outboxSender(authDb, 'preview');
    await outbox.send({ to: 'old@example.com', subject: 'Antigo', text: 'Texto' });
    await asAdmin(database, (client) =>
      client.query("UPDATE auth.outbox SET expires_at = now() - interval '1 second'"),
    );
    await outbox.send({ to: 'new@example.com', subject: 'Novo', text: 'Texto' });
    expect(await readOutbox(authDb, 'preview')).toEqual([
      expect.objectContaining({ to: 'new@example.com', subject: 'Novo', text: 'Texto' }),
    ]);
    const stored = await asAdmin(database, (client) =>
      client.query<{ recipient: string; days: number }>(
        `SELECT recipient, extract(day FROM expires_at - created_at)::int AS days FROM auth.outbox`,
      ),
    );
    expect(stored.rows).toEqual([{ recipient: 'new@example.com', days: 7 }]);
  });
});
