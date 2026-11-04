import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createI18n } from '@arca/i18n';
import { createApp, type App } from '../../src/app.js';
import { createAuth, credentialStore, type Auth } from '../../src/auth/auth.js';
import { ownerCode } from '../../src/auth/enrollment.js';
import { registrationHooks, type RegistrationHooks } from '../../src/auth/registration.js';
import { createStepUp } from '../../src/auth/step-up.js';
import { authService } from '../../src/auth/service.js';
import { auditLog, auditReader } from '../../src/audit/log.js';
import { signInFailedLog } from '../../src/auth/limits.js';
import { rateLimiter, type RateLimiter } from '../../src/auth/rate-limit.js';
import { noticeNewSignIn, recordPasskeyClient } from '../../src/auth/sign-in-notice.js';
import { createNotices, type Notice, type Notices } from '../../src/email/notices.js';
import { outboxSender, readOutbox } from '../../src/email/outbox.js';
import type { Database } from '@arca/db';
import { cookiesFrom } from '../cookies.js';
import { allowAll } from '../limits.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';
import { softwarePasskey, type SoftwarePasskey } from '../software-passkey.js';

// Better Auth on the real auth migrations and the app_auth pool, against a disposable Postgres
// server (spec 0003, R1). Synthetic addresses on reserved domains only.
const secret = randomBytes(32).toString('base64url');
const origin = 'http://localhost:3000';
const logger = silentLogger;

let testDatabase: AuthTestDatabase;
const asAdmin = <T>(use: (client: pg.Client) => Promise<T>) => testDatabase.asAdmin(use);
let auth: Auth;
let authDb: Database;
let auditDb: Database;
let notices: Notices;
let limiter: RateLimiter;
let app: App;
let registration: RegistrationHooks;

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  ({ authDb, auditDb } = testDatabase);
  notices = createNotices({
    email: outboxSender(authDb, 'preview'),
    i18n: await createI18n(),
    origin,
  });
  limiter = rateLimiter({ db: authDb, key: randomBytes(32).toString('base64url') });
  registration = registrationHooks({
    db: authDb,
    audit: auditLog(auditDb),
    ownerCode: ownerCode(null),
  });
  auth = createAuth({
    db: authDb,
    registration,
    secret,
    origin,
    logger,
    audit: auditLog(auditDb),
    notices,
    limiter,
  });
  app = appFor(auth, auditReader(testDatabase.apiDb));
});

function appFor(target: Auth, audit?: ReturnType<typeof auditReader>): App {
  return createApp({
    accountsOpen: true,
    checkDatabase: () => Promise.resolve('ok'),
    logger,
    origin,
    auth: authService(target),
    // The limits have their own tests below; these sign in far more often than one address may.
    authLimits: { limiter: allowAll, clientAddress: () => '192.0.2.10' },
    stepUp: createStepUp({
      db: authDb,
      credentials: credentialStore(authDb),
      audit: auditLog(auditDb),
      origin,
      logger,
    }),
    ...(audit === undefined ? {} : { audit }),
  });
}

afterAll(async () => {
  await testDatabase.drop();
});

const firefoxOnLinux = 'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0';
const chromeOnAndroid =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

/** A synthetic account with one passkey held by a software authenticator. */
async function account(email: string): Promise<{ userId: string; passkey: SoftwarePasskey }> {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    { email, name: '', emailVerified: true },
    { method: 'test' },
  );
  return { userId: user.id, passkey: await addPasskey(user.id) };
}

/** Another software passkey for an account; returns it once its row is stored. */
async function addPasskey(userId: string): Promise<SoftwarePasskey> {
  const passkey = softwarePasskey(new URL(origin).hostname);
  await asAdmin((client) =>
    client.query(
      `INSERT INTO auth.passkey (public_key, user_id, credential_id, counter, device_type, backed_up)
       VALUES ($1, $2, $3, 0, 'multiDevice', true)`,
      [passkey.publicKey, userId, passkey.credentialId],
    ),
  );
  return passkey;
}

interface SignInOptions {
  readonly userAgent?: string;
  readonly userVerified?: boolean;
  readonly via?: App;
}

/** The two requests of a passkey sign-in, through the allow-list, as the web app makes them. */
async function passkeySignIn(
  passkey: SoftwarePasskey,
  { userAgent, userVerified, via = app }: SignInOptions = {},
) {
  const agent: Record<string, string> = userAgent === undefined ? {} : { 'user-agent': userAgent };
  const options = await via.request('/v1/auth/passkey/generate-authenticate-options', {
    headers: agent,
  });
  const { challenge, userVerification } = (await options.json()) as {
    challenge: string;
    userVerification: string;
  };
  expect(userVerification).toBe('required');
  const verified = await via.request('/v1/auth/passkey/verify-authentication', {
    method: 'POST',
    headers: {
      ...agent,
      origin,
      cookie: cookiesFrom(options),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      response: passkey.assert({
        challenge,
        origin,
        ...(userVerified === undefined ? {} : { userVerified }),
      }),
    }),
  });
  return { options, verified };
}

async function signedIn(email: string, signIn: SignInOptions = {}) {
  const { userId, passkey } = await account(email);
  const { verified } = await passkeySignIn(passkey, signIn);
  expect(verified.status).toBe(200);
  return { cookie: cookiesFrom(verified), userId, passkey };
}

function setsSession(response: Response): boolean {
  return response.headers
    .getSetCookie()
    .some(
      (cookie) => cookie.startsWith('__Host-arca.session_token=') && !/max-age=0/i.test(cookie),
    );
}

async function sessionsOf(userId: string) {
  return asAdmin(async (client) => {
    const result = await client.query<{ credentialId: string }>(
      'SELECT credential_id AS "credentialId" FROM auth.session WHERE user_id = $1',
      [userId],
    );
    return result.rows;
  });
}

describe('Better Auth on the app_auth pool', () => {
  it('returns the session and stores no network details', async () => {
    const { cookie, userId } = await signedIn('owner@example.com');
    const response = await app.request('/v1/session', { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accountId: userId,
      email: 'owner@example.com',
      confirmed: false,
      device: { browser: 'other', os: 'other' },
      pendingPasskeyUntil: null,
      recoveryPending: false,
      deletionDueAt: null,
    });
    const stored = await asAdmin(async (client) => {
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

  it('records the passkey that signed the session in', async () => {
    const { userId, passkey } = await signedIn('credential@example.com');
    expect(await sessionsOf(userId)).toEqual([{ credentialId: passkey.credentialId }]);
  });

  it('slides the idle expiry on GET /v1/session and passes the cookie on', async () => {
    const { cookie, userId } = await signedIn('reader@example.com');
    // One day left of three: past the one-day update age, so a refresh moves it.
    const expiry = async () =>
      asAdmin(async (client) => {
        const result = await client.query<{ hoursLeft: number }>(
          `SELECT extract(epoch FROM expires_at - now()) / 3600 AS "hoursLeft"
             FROM auth.session WHERE user_id = $1`,
          [userId],
        );
        return Number(result.rows[0]?.hoursLeft);
      });
    await asAdmin((client) =>
      client.query(
        "UPDATE auth.session SET expires_at = now() + interval '1 day' WHERE user_id = $1",
        [userId],
      ),
    );
    expect((await app.request('/v1/audit/events', { headers: { cookie } })).status).toBe(200);
    expect(await expiry()).toBeLessThan(25);
    const response = await app.request('/v1/session', { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await expiry()).toBeGreaterThan(71);
    expect(setsSession(response)).toBe(true);
  });

  it('refuses a session older than 30 days, even an active one', async () => {
    const { cookie, userId } = await signedIn('old@example.org');
    await asAdmin((client) =>
      client.query(
        `UPDATE auth.session SET created_at = now() - interval '30 days 1 minute',
                expires_at = now() + interval '2 days' WHERE user_id = $1`,
        [userId],
      ),
    );
    const response = await app.request('/v1/session', { headers: { cookie } });
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect((await app.request('/v1/audit/events', { headers: { cookie } })).status).toBe(401);
  });

  it('never slides a session from the sign-in options, even one past 30 days', async () => {
    const { cookie, userId } = await signedIn('lingering@example.org');
    await asAdmin((client) =>
      client.query(
        `UPDATE auth.session SET created_at = now() - interval '31 days',
                expires_at = now() + interval '1 day' WHERE user_id = $1`,
        [userId],
      ),
    );
    const options = await app.request('/v1/auth/passkey/generate-authenticate-options', {
      headers: { cookie },
    });
    expect(options.status).toBe(200);
    expect(setsSession(options)).toBe(false);
    expect(setsSession(await app.request('/v1/session', { headers: { cookie } }))).toBe(false);
    const left = await asAdmin(async (client) => {
      const result = await client.query<{ hours: number }>(
        `SELECT extract(epoch FROM expires_at - now()) / 3600 AS hours
           FROM auth.session WHERE user_id = $1`,
        [userId],
      );
      return Number(result.rows[0]?.hours);
    });
    expect(left).toBeLessThan(25);
  });

  it('sweeps abandoned challenges whenever a new one is issued', async () => {
    await asAdmin((client) =>
      client.query(
        `INSERT INTO auth.verification (identifier, value, expires_at)
         VALUES ('abandoned', '{}', now() - interval '1 minute')`,
      ),
    );
    await app.request('/v1/auth/passkey/generate-authenticate-options');
    const left = await asAdmin((client) =>
      client.query("SELECT FROM auth.verification WHERE identifier = 'abandoned'"),
    );
    expect(left.rowCount).toBe(0);
  });

  it("refuses a session tied to another account's passkey", async () => {
    const { userId } = await signedIn('first@example.com');
    const { passkey } = await account('second@example.com');
    await expect(
      asAdmin((client) =>
        client.query(
          `INSERT INTO auth.session (expires_at, token, user_id, device_browser, device_os, credential_id)
           VALUES (now() + interval '1 day', 'test-only-token', $1, 'other', 'other', $2)`,
          [userId, passkey.credentialId],
        ),
      ),
    ).rejects.toThrow(/session_credential_fkey/);
  });

  it('refuses an assertion made without user verification, and opens no session', async () => {
    const { userId, passkey } = await account('unverified@example.com');
    const { verified } = await passkeySignIn(passkey, { userVerified: false });
    expect(verified.status).toBe(401);
    expect(await verified.json()).toEqual({ error: { code: 'unauthorized' } });
    expect(setsSession(verified)).toBe(false);
    expect(await sessionsOf(userId)).toEqual([]);
  });

  it('refuses a sign-in with a pending passkey, and accepts it once the wait is over', async () => {
    const { userId, passkey } = await account('pending@example.com');
    const pending = (activeFrom: string) =>
      asAdmin((client) =>
        client.query(
          `INSERT INTO auth.passkey_activation (credential_id, active_from)
           VALUES ($1, now() + $2::interval)
           ON CONFLICT (credential_id) DO UPDATE SET active_from = excluded.active_from`,
          [passkey.credentialId, activeFrom],
        ),
      );
    await pending('24 hours');
    const { verified } = await passkeySignIn(passkey);
    expect(verified.status).toBe(401);
    expect(setsSession(verified)).toBe(false);
    expect(await sessionsOf(userId)).toEqual([]);
    await pending('-1 second');
    expect((await passkeySignIn(passkey)).verified.status).toBe(200);
  });

  it('sets only __Host- cookies, with the session cookie locked down', async () => {
    const { userId, passkey } = await account('cookies@example.com');
    const { options, verified } = await passkeySignIn(passkey);
    const cookie = cookiesFrom(verified);
    await asAdmin((client) =>
      client.query(
        "UPDATE auth.session SET expires_at = now() + interval '1 day' WHERE user_id = $1",
        [userId],
      ),
    );
    const refreshed = await app.request('/v1/session', { headers: { cookie } });
    const signOut = await app.request('/v1/auth/sign-out', {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: '{}',
    });
    const all = [options, verified, refreshed, signOut].flatMap((r) => r.headers.getSetCookie());
    expect(all.length).toBeGreaterThanOrEqual(4);
    for (const setCookie of all) {
      expect(setCookie).toMatch(/^__Host-/);
      expect(setCookie).toMatch(/; Secure/i);
      expect(setCookie).toMatch(/; Path=\/(;|$)/i);
      expect(setCookie).not.toMatch(/; Domain=/i);
    }
    const session = all.find(
      (c) => c.startsWith('__Host-arca.session_token=') && !/max-age=0/i.test(c),
    );
    expect(session).toMatch(/; HttpOnly/i);
    expect(session).toMatch(/; SameSite=Lax/i);
  });

  it('ends the sessions of a passkey when the passkey is deleted', async () => {
    const { cookie, userId, passkey } = await signedIn('revoked@example.org');
    await authDb.execute(
      sql`DELETE FROM auth.passkey WHERE credential_id = ${passkey.credentialId}`,
    );
    expect(await sessionsOf(userId)).toEqual([]);
    expect((await app.request('/v1/session', { headers: { cookie } })).status).toBe(401);
  });

  it('refuses an expired session', async () => {
    const { cookie, userId } = await signedIn('expired@example.org');
    await asAdmin((client) =>
      client.query(
        "UPDATE auth.session SET expires_at = now() - interval '1 minute' WHERE user_id = $1",
        [userId],
      ),
    );
    const response = await app.request('/v1/session', { headers: { cookie } });
    expect(response.status).toBe(401);
    // Better Auth's clearing cookie reaches the browser, so it drops the dead one.
    expect(
      response.headers
        .getSetCookie()
        .some((c) => c.startsWith('__Host-arca.session_token=') && /max-age=0/i.test(c)),
    ).toBe(true);
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
    const remaining = await asAdmin((client) =>
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
    const { cookie, passkey } = await signedIn('pager@example.com');
    await passkeySignIn(passkey);
    await passkeySignIn(passkey);
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
    const { userId, passkey } = await signedIn('unrecorded@example.com');
    const failing = createAuth({
      db: authDb,
      registration,
      secret,
      origin,
      logger,
      audit: { record: () => Promise.reject(new Error('audit unavailable')) },
      notices,
      limiter,
    });
    const { verified } = await passkeySignIn(passkey, { via: appFor(failing) });
    // The passkey plugin turns any error after verification into a failed sign-in.
    expect(verified.status).toBe(401);
    expect(setsSession(verified)).toBe(false);
    expect(await sessionsOf(userId)).toHaveLength(1);
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
  return (await account(email)).passkey.credentialId;
}

async function outboxFor(recipient: string) {
  return asAdmin(async (client) => {
    const result = await client.query<{ subject: string }>(
      'SELECT subject FROM auth.outbox WHERE recipient = $1',
      [recipient],
    );
    return result.rows;
  });
}

describe('step-up through the API (spec 0003, R5)', () => {
  const stepUp = (path: string, cookie: string, body: unknown) =>
    app.request(`/v1/auth/step-up/${path}`, {
      method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('verifies a step-up for the session in the cookie', async () => {
    const { cookie, passkey } = await signedIn('step-up@example.com');
    const options = await stepUp('options', cookie, { purpose: 'vault_unlock' });
    expect(options.status).toBe(200);
    const { challengeId, options: request } = (await options.json()) as {
      challengeId: string;
      options: { challenge: string };
    };
    const response = passkey.assert({ challenge: request.challenge, origin });
    expect((await stepUp('verify', cookie, { challengeId, response })).status).toBe(200);
    expect((await stepUp('verify', cookie, { challengeId, response })).status).toBe(403);
  });

  it('refuses a step-up without a session', async () => {
    expect((await stepUp('options', '', { purpose: 'vault_unlock' })).status).toBe(401);
  });
});

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

  it('emails one notice when a real sign-in comes from a new family, and none on a repeat', async () => {
    const email = 'traveller@example.com';
    const { passkey } = await signedIn(email, { userAgent: firefoxOnLinux });
    await passkeySignIn(passkey, { userAgent: firefoxOnLinux });
    expect(await outboxFor(email)).toEqual([]);
    await passkeySignIn(passkey, { userAgent: chromeOnAndroid });
    await passkeySignIn(passkey, { userAgent: chromeOnAndroid });
    expect(await outboxFor(email)).toEqual([{ subject: 'Nova entrada na sua conta' }]);
  });

  it('still signs in when the notice cannot be sent', async () => {
    const lines: unknown[] = [];
    const failing = createAuth({
      db: authDb,
      registration,
      secret,
      origin,
      logger: { info: () => undefined, error: (line) => lines.push(line) },
      audit: auditLog(auditDb),
      notices: { send: () => Promise.reject(new Error('email unavailable')) },
      limiter,
    });
    const { passkey } = await signedIn('unnoticed@example.org', { userAgent: firefoxOnLinux });
    const { verified } = await passkeySignIn(passkey, {
      userAgent: chromeOnAndroid,
      via: appFor(failing),
    });
    expect(verified.status).toBe(200);
    expect(lines).toEqual([{ errorName: 'SignInNotice:Error' }]);
  });

  it('retries the notice on the next sign-in when sending failed', async () => {
    const email = 'retried@example.com';
    const failing = createAuth({
      db: authDb,
      registration,
      secret,
      origin,
      logger,
      audit: auditLog(auditDb),
      notices: { send: () => Promise.reject(new Error('email unavailable')) },
      limiter,
    });
    const { passkey } = await signedIn(email, { userAgent: firefoxOnLinux });
    await passkeySignIn(passkey, { userAgent: chromeOnAndroid, via: appFor(failing) });
    expect(await outboxFor(email)).toEqual([]);
    await passkeySignIn(passkey, { userAgent: chromeOnAndroid });
    expect(await outboxFor(email)).toEqual([{ subject: 'Nova entrada na sua conta' }]);
  });

  it('forgets the families when app_auth deletes the passkey', async () => {
    const credentialId = await withPasskey('forget@example.org');
    await recordPasskeyClient(authDb, credentialId, { browser: 'safari', os: 'ios' });
    await authDb.execute(sql`DELETE FROM auth.passkey WHERE credential_id = ${credentialId}`);
    const remaining = await asAdmin((client) =>
      client.query('SELECT FROM auth.passkey_client WHERE credential_id = $1', [credentialId]),
    );
    expect(remaining.rowCount).toBe(0);
  });
});

describe('the outbox (spec 0003, R8)', () => {
  it('keeps sent messages for the preview page and drops them after 7 days', async () => {
    const outbox = outboxSender(authDb, 'preview');
    await outbox.send({ to: 'old@example.com', subject: 'Antigo', text: 'Texto' });
    await asAdmin((client) =>
      client.query("UPDATE auth.outbox SET expires_at = now() - interval '1 second'"),
    );
    await outbox.send({ to: 'new@example.com', subject: 'Novo', text: 'Texto' });
    expect(await readOutbox(authDb, 'preview')).toEqual([
      expect.objectContaining({ to: 'new@example.com', subject: 'Novo', text: 'Texto' }),
    ]);
    const stored = await asAdmin((client) =>
      client.query<{ recipient: string; days: number }>(
        `SELECT recipient, extract(day FROM expires_at - created_at)::int AS days FROM auth.outbox`,
      ),
    );
    expect(stored.rows).toEqual([{ recipient: 'new@example.com', days: 7 }]);
  });
});

describe('the auth rate limits (spec 0003, R10)', () => {
  const address = '198.51.100.23';
  const limitedApp = () =>
    createApp({
      checkDatabase: () => Promise.resolve('ok'),
      logger,
      origin,
      auth: authService(auth),
      authLimits: { limiter, clientAddress: () => address },
    });

  async function counterKeys() {
    return asAdmin(async (client) => {
      const result = await client.query<{ key: string }>('SELECT key FROM auth.rate_limit');
      return result.rows.map((row) => row.key);
    });
  }

  it('answers 429 past the per-IP sign-in limit, with Retry-After', async () => {
    const limited = limitedApp();
    const attempt = () =>
      limited.request('/v1/auth/passkey/verify-authentication', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: '{}',
      });
    for (let count = 0; count < 30; count += 1) expect((await attempt()).status).toBe(400);
    const refused = await attempt();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: { code: 'rate_limited' } });
    const retryAfter = Number(refused.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);
  });

  it('stores only the limit name and an HMAC, never the address', async () => {
    await limitedApp().request('/v1/auth/passkey/generate-authenticate-options');
    const keys = await counterKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z_]+:[A-Za-z0-9_-]{43}$/);
      expect(key).not.toContain(address);
    }
  });

  it('starts fresh counters under a rotated key', async () => {
    const rule = { name: 'rotation_test', limit: 1, windowSeconds: 3600 };
    const before = rateLimiter({ db: authDb, key: randomBytes(32).toString('base64url') });
    expect((await before.hit(rule, address)).allowed).toBe(true);
    expect((await before.hit(rule, address)).allowed).toBe(false);
    const rotated = rateLimiter({ db: authDb, key: randomBytes(32).toString('base64url') });
    expect((await rotated.hit(rule, address)).allowed).toBe(true);
  });

  it('opens a new window once the old one ends, and the sweep deletes ended windows', async () => {
    const rule = { name: 'window_test', limit: 1, windowSeconds: 3600 };
    expect((await limiter.hit(rule, address)).allowed).toBe(true);
    expect((await limiter.hit(rule, address)).allowed).toBe(false);
    await asAdmin((client) =>
      client.query(
        "UPDATE auth.rate_limit SET expires_at = now() - interval '1 second' WHERE key LIKE 'window_test:%'",
      ),
    );
    expect((await limiter.hit(rule, address)).allowed).toBe(true);
    await asAdmin((client) =>
      client.query(
        "UPDATE auth.rate_limit SET expires_at = now() - interval '1 second' WHERE key LIKE 'window_test:%'",
      ),
    );
    expect(await limiter.sweep()).toBeGreaterThanOrEqual(1);
    expect((await counterKeys()).filter((key) => key.startsWith('window_test:'))).toEqual([]);
  });

  async function failedSignIns(userId: string) {
    return asAdmin(async (client) => {
      const result = await client.query<{ actor: string | null; details: unknown }>(
        `SELECT actor_account_id AS actor, details FROM audit.event
         WHERE subject_account_id = $1 AND code = 'sign_in_failed'`,
        [userId],
      );
      return result.rows;
    });
  }

  async function passkeyIdOf(credentialId: string) {
    return asAdmin(async (client) => {
      const result = await client.query<{ id: string }>(
        'SELECT id FROM auth.passkey WHERE credential_id = $1',
        [credentialId],
      );
      return result.rows[0]?.id;
    });
  }

  async function failedTwice(passkey: SoftwarePasskey, via: App = app) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { verified } = await passkeySignIn(passkey, { userVerified: false, via });
      expect(verified.status).toBe(401);
    }
  }

  it('records one sign_in_failed event per credential per window', async () => {
    const { userId, passkey } = await account('failing@example.com');
    await failedTwice(passkey);
    expect(await failedSignIns(userId)).toEqual([
      { actor: null, details: { passkeyId: await passkeyIdOf(passkey.credentialId) } },
    ]);
    expect(signInFailedLog).toEqual({ name: 'sign_in_failed_log', limit: 1, windowSeconds: 3600 });
  });

  it('counts the failure log per credential, not per account', async () => {
    const { userId, passkey } = await account('two-keys@example.org');
    const other = await addPasskey(userId);
    await failedTwice(passkey);
    await failedTwice(other);
    const recorded = (await failedSignIns(userId)).map(({ details }) => details);
    expect(recorded).toHaveLength(2);
    expect(recorded).toEqual(
      expect.arrayContaining([
        { passkeyId: await passkeyIdOf(passkey.credentialId) },
        { passkeyId: await passkeyIdOf(other.credentialId) },
      ]),
    );
  });

  it('still refuses the sign-in when the failure log cannot be counted', async () => {
    const lines: unknown[] = [];
    const failing = createAuth({
      db: authDb,
      registration,
      secret,
      origin,
      logger: { info: () => undefined, error: (line) => lines.push(line) },
      audit: auditLog(auditDb),
      notices,
      limiter: {
        hit: () => Promise.reject(new Error('counter unavailable')),
      },
    });
    const { userId, passkey } = await account('uncounted@example.com');
    await failedTwice(passkey, appFor(failing));
    expect(await failedSignIns(userId)).toEqual([]);
    expect(lines).toEqual([
      { errorName: 'SignInFailedLog:Error' },
      { errorName: 'SignInFailedLog:Error' },
    ]);
  });

  it('records nothing for a credential no account holds', async () => {
    const recorded = () =>
      asAdmin(async (client) => {
        const result = await client.query<{ count: string }>(
          "SELECT count(*) AS count FROM audit.event WHERE code = 'sign_in_failed'",
        );
        return result.rows[0]?.count;
      });
    const before = await recorded();
    const { verified } = await passkeySignIn(softwarePasskey(new URL(origin).hostname));
    expect(verified.status).toBe(401);
    expect(await recorded()).toBe(before);
  });
});
