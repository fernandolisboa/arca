import { createHash, randomBytes } from 'node:crypto';
import type { PasskeyCreationOptions } from '@arca/api-contract/routes';
import { createI18n } from '@arca/i18n';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from '../../src/app.js';
import { auditLog, auditReader } from '../../src/audit/log.js';
import { createAuth, credentialStore } from '../../src/auth/auth.js';
import { createEnrollment, ownerCode } from '../../src/auth/enrollment.js';
import { recoveryCodeHash, recoveryKits } from '../../src/auth/recovery-kit.js';
import { registration, registrationHooks } from '../../src/auth/registration.js';
import { authService } from '../../src/auth/service.js';
import { createStepUp } from '../../src/auth/step-up.js';
import { createNotices } from '../../src/email/notices.js';
import { outboxSender, readOutbox } from '../../src/email/outbox.js';
import { cookiesFrom } from '../cookies.js';
import { allowAll } from '../limits.js';
import { softwarePasskey, type SoftwarePasskey } from '../software-passkey.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';

// Owner enrollment, registration and the recovery kit on the real migrations, from an empty
// database (spec 0003, R2, R3 and R6). Synthetic addresses on reserved domains only.
const origin = 'http://localhost:3000';
const rpId = 'localhost';
const code = randomBytes(16).toString('base64url');
const codeHash = createHash('sha256').update(code).digest('hex');
const ownerEmail = 'owner@example.com';

let testDatabase: AuthTestDatabase;
let app: App;

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  const { authDb, auditDb, apiDb } = testDatabase;
  const i18n = await createI18n();
  const email = outboxSender(authDb, 'preview');
  const notices = createNotices({ email, i18n, origin });
  const audit = auditLog(auditDb);
  const matching = ownerCode(codeHash);
  const hooks = registrationHooks({ db: authDb, audit, ownerCode: matching });
  const auth = createAuth({
    db: authDb,
    secret: randomBytes(32).toString('base64url'),
    origin,
    logger: silentLogger,
    audit,
    notices,
    limiter: allowAll,
    registration: hooks,
  });
  app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: authService(auth),
    authLimits: { limiter: allowAll, clientAddress: () => '192.0.2.20' },
    stepUp: createStepUp({
      db: authDb,
      credentials: credentialStore(authDb),
      audit,
      origin,
      logger: silentLogger,
    }),
    enrollment: createEnrollment({ db: authDb, email, i18n, origin, ownerCode: matching }),
    registration: registration(auth, hooks, matching, silentLogger),
    recoveryKits: recoveryKits({ db: authDb, audit, notices, logger: silentLogger }),
    audit: auditReader(apiDb),
  });
});

afterAll(async () => {
  await testDatabase.drop();
});

const post = async (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const enrollOwner = (typed = code, email = ownerEmail) =>
  post('/v1/auth/enroll-owner', { code: typed, email });

const outbox = () => readOutbox(testDatabase.authDb, 'preview');

/** The token of the newest enrollment link, read from the fragment as the web app would. */
async function latestToken(): Promise<string> {
  const [message] = (await outbox()).filter((entry) => entry.text.includes('/enroll#'));
  const token = /\/enroll#([A-Za-z0-9_-]+)/.exec(message?.text ?? '')?.[1];
  if (token === undefined) throw new Error('no enrollment link in the outbox');
  return token;
}

/** Null sends no code at all. */
const options = (token: string, typed: string | null = code) =>
  post('/v1/auth/registration/options', typed === null ? { token } : { token, code: typed });

interface Completion {
  readonly passkey?: SoftwarePasskey;
  readonly typed?: string;
  readonly userVerified?: boolean;
  readonly prfEnabled?: boolean;
}

/** Options, a new passkey's attestation, then verify, as the enrollment page makes them. */
async function register(
  token: string,
  { passkey = softwarePasskey(rpId), typed = code, userVerified, prfEnabled }: Completion = {},
) {
  const offered = await options(token);
  expect(offered.status).toBe(200);
  const creation = (await offered.json()) as PasskeyCreationOptions;
  const response = passkey.attest({
    challenge: creation.challenge,
    origin,
    ...(userVerified === undefined ? {} : { userVerified }),
    ...(prfEnabled === undefined ? {} : { prfEnabled }),
  });
  const verified = await post(
    '/v1/auth/registration/verify',
    { token, code: typed, response },
    { cookie: cookiesFrom(offered) },
  );
  return { creation, passkey, verified };
}

const accountCount = () =>
  testDatabase.asAdmin(
    async (client) =>
      (await client.query<{ n: number }>('SELECT count(*)::int AS n FROM auth.user')).rows[0]?.n,
  );

let owner: { cookie: string; passkey: SoftwarePasskey; creation: PasskeyCreationOptions };

describe('owner enrollment (spec 0003, R2)', () => {
  it('answers 404 to a code that is not the configured one, and sends nothing', async () => {
    expect((await enrollOwner('not-the-code')).status).toBe(404);
    expect(await outbox()).toEqual([]);
  });

  it('emails a link whose token is only in the fragment and stored only as a hash', async () => {
    const response = await enrollOwner(code, 'Owner@Example.com');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    const [message] = await outbox();
    expect(message?.to).toBe(ownerEmail);
    expect(message?.text).toContain(`${origin}/enroll#`);
    const token = await latestToken();
    const stored = await testDatabase.asAdmin(async (client) => {
      const result = await client.query<{ token_hash: Buffer; email: string }>(
        'SELECT token_hash, email FROM auth.registration_context',
      );
      return result.rows;
    });
    expect(stored).toEqual([
      { token_hash: createHash('sha256').update(token).digest(), email: ownerEmail },
    ]);
  });

  it('replaces an earlier link when a new one is sent', async () => {
    const earlier = await latestToken();
    expect((await enrollOwner()).status).toBe(200);
    const later = await latestToken();
    expect(later).not.toBe(earlier);
    expect((await options(earlier)).status).toBe(404);
    expect((await options(later)).status).toBe(200);
  });

  it('checks the code before the ceremony, so a typo costs no passkey', async () => {
    const token = await latestToken();
    for (const typed of ['not-the-code', null]) {
      const refused = await options(token, typed);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: { code: 'invalid_code' } });
    }
  });

  it('refuses a forged link and an expired one', async () => {
    expect((await options(randomBytes(32).toString('base64url'))).status).toBe(404);
    const token = await latestToken();
    await testDatabase.asAdmin((client) =>
      client.query("UPDATE auth.registration_context SET expires_at = now() - interval '1 second'"),
    );
    expect((await options(token)).status).toBe(404);
    expect((await enrollOwner()).status).toBe(200);
  });

  it('creates no account when verify carries a wrong code or no user verification', async () => {
    const token = await latestToken();
    const wrongCode = await register(token, { typed: 'not-the-code' });
    expect(wrongCode.verified.status).toBe(403);
    expect(await wrongCode.verified.json()).toEqual({ error: { code: 'registration_refused' } });
    const unverified = await register(token, { userVerified: false });
    expect(unverified.verified.status).toBe(403);
    expect(await accountCount()).toBe(0);
    expect(
      await testDatabase.asAdmin(
        async (client) => (await client.query('SELECT FROM auth.setup')).rowCount,
      ),
    ).toBe(0);
  });

  it('rolls the account back when its session cannot be stored', async () => {
    await testDatabase.asAdmin((client) =>
      client.query(`
        CREATE FUNCTION auth.refuse_session() RETURNS trigger LANGUAGE plpgsql AS
          $$ BEGIN RAISE EXCEPTION 'session refused for the test'; END $$;
        CREATE TRIGGER refuse_session BEFORE INSERT ON auth.session
          FOR EACH ROW EXECUTE FUNCTION auth.refuse_session();`),
    );
    try {
      const { verified } = await register(await latestToken());
      expect(verified.status).toBe(403);
    } finally {
      await testDatabase.asAdmin((client) =>
        client.query(
          'DROP TRIGGER refuse_session ON auth.session; DROP FUNCTION auth.refuse_session()',
        ),
      );
    }
    const left = await testDatabase.asAdmin(async (client) => {
      const result = await client.query<{ table: string; n: number }>(`
        SELECT 'user' AS table, count(*)::int AS n FROM auth.user
        UNION ALL SELECT 'passkey', count(*)::int FROM auth.passkey
        UNION ALL SELECT 'setup', count(*)::int FROM auth.setup
        UNION ALL SELECT 'context', count(*)::int FROM auth.registration_context`);
      return result.rows;
    });
    expect(left).toEqual([
      { table: 'user', n: 0 },
      { table: 'passkey', n: 0 },
      { table: 'setup', n: 0 },
      { table: 'context', n: 1 },
    ]);
  });

  it('creates one account when two completions race', async () => {
    const token = await latestToken();
    const [first, second] = await Promise.all([
      options(token).then(async (offered) => ({
        offered,
        creation: (await offered.json()) as PasskeyCreationOptions,
      })),
      options(token).then(async (offered) => ({
        offered,
        creation: (await offered.json()) as PasskeyCreationOptions,
      })),
    ]);
    const attempts = [first, second].map(({ offered, creation }) => {
      const passkey = softwarePasskey(rpId);
      return {
        passkey,
        creation,
        verified: post(
          '/v1/auth/registration/verify',
          {
            token,
            code,
            response: passkey.attest({ challenge: creation.challenge, origin, prfEnabled: true }),
          },
          { cookie: cookiesFrom(offered) },
        ),
      };
    });
    const answers = await Promise.all(attempts.map((attempt) => attempt.verified));
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 403]);
    expect(await accountCount()).toBe(1);
    const winner = answers.findIndex((answer) => answer.status === 200);
    const attempt = attempts[winner];
    const answer = answers[winner];
    if (attempt === undefined || answer === undefined) throw new Error('no completion won');
    owner = { cookie: cookiesFrom(answer), passkey: attempt.passkey, creation: attempt.creation };
  });

  it('asks for a discoverable passkey with user verification and an empty PRF request', () => {
    expect(owner.creation.authenticatorSelection).toEqual({
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    });
    expect(owner.creation.extensions).toEqual({ prf: {} });
    expect(owner.creation.rp.id).toBe(rpId);
    expect(owner.creation.user.name).toBe(ownerEmail);
  });

  it('records PRF support for the passkey', async () => {
    const stored = await testDatabase.asAdmin(async (client) => {
      const result = await client.query<{ credential_id: string; prf_enabled: boolean }>(
        'SELECT credential_id, prf_enabled FROM auth.passkey_capability',
      );
      return result.rows;
    });
    expect(stored).toEqual([{ credential_id: owner.passkey.credentialId, prf_enabled: true }]);
  });

  it('signs the confirmed owner in, recorded, with no new-sign-in notice', async () => {
    const session = await app.request('/v1/session', { headers: { cookie: owner.cookie } });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ email: ownerEmail });
    const account = await testDatabase.asAdmin(async (client) => {
      const result = await client.query<{ confirmed: boolean; email_verified: boolean }>(
        'SELECT confirmed_at IS NOT NULL AS confirmed, email_verified FROM auth.user',
      );
      return result.rows;
    });
    expect(account).toEqual([{ confirmed: true, email_verified: true }]);
    const notices = (await outbox()).filter((entry) => !entry.text.includes('/enroll#'));
    expect(notices).toEqual([]);
    const events = await app.request('/v1/audit/events', { headers: { cookie: owner.cookie } });
    const { events: recorded } = (await events.json()) as { events: { code: string }[] };
    expect(recorded.map((event) => event.code).sort()).toEqual(['owner_enrolled', 'sign_in']);
  });

  it('spends the link', async () => {
    expect((await options(await latestToken())).status).toBe(404);
  });

  it('answers 404 once an account exists, whatever the code', async () => {
    expect((await enrollOwner()).status).toBe(404);
    expect((await enrollOwner('not-the-code')).status).toBe(404);
  });

  it('keeps the plugin registration endpoints off the allow-list', async () => {
    const raw = await app.request('/v1/auth/passkey/generate-register-options?context=x');
    expect(raw.status).toBe(404);
    const verify = await post('/v1/auth/passkey/verify-registration', { response: {} });
    expect(verify.status).toBe(404);
  });
});

const kitRows = () =>
  testDatabase.asAdmin(async (client) => {
    const result = await client.query<{
      salt: Buffer;
      code_hash: Buffer;
      confirmed_at: Date | null;
    }>('SELECT salt, code_hash, confirmed_at FROM auth.recovery_code');
    return result.rows;
  });

const kit = (headers: Record<string, string> = {}) =>
  post('/v1/account/recovery-kit', {}, { cookie: owner.cookie, ...headers });

describe('the recovery kit (spec 0003, R6)', () => {
  let first: string;

  it('issues the first kit without a step-up and stores only a salted hash', async () => {
    const before = await app.request('/v1/account/recovery-kit', {
      headers: { cookie: owner.cookie },
    });
    expect(await before.json()).toEqual({ status: 'none' });
    const issued = await kit();
    expect(issued.status).toBe(200);
    ({ code: first } = (await issued.json()) as { code: string });
    expect(first).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const [row] = await kitRows();
    expect(row?.salt).toHaveLength(16);
    expect(row?.code_hash).toEqual(recoveryCodeHash(row?.salt ?? Buffer.alloc(0), first));
    const after = await app.request('/v1/account/recovery-kit', {
      headers: { cookie: owner.cookie },
    });
    expect(await after.json()).toEqual({ status: 'unsaved' });
  });

  it('asks for a step-up to replace a kit, even one not saved yet', async () => {
    const refused = await kit();
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: { code: 'step_up_required' } });
  });

  it('never shows the kit again once it is saved', async () => {
    const confirmed = await post('/v1/account/recovery-kit/confirm', {}, { cookie: owner.cookie });
    expect(confirmed.status).toBe(200);
    const status = await app.request('/v1/account/recovery-kit', {
      headers: { cookie: owner.cookie },
    });
    expect(await status.json()).toEqual({ status: 'saved' });
    expect((await kit()).status).toBe(403);
  });

  it('replaces the kit after a step-up for that action, and only for its nonce', async () => {
    const nonce = randomBytes(16).toString('base64url');
    const challenge = await post(
      '/v1/auth/step-up/options',
      {
        purpose: 'sensitive_settings',
        target: { action: 'regenerateRecoveryKit', targets: [], nonce },
      },
      { cookie: owner.cookie },
    );
    const { challengeId, options: request } = (await challenge.json()) as {
      challengeId: string;
      options: { challenge: string };
    };
    const verified = await post(
      '/v1/auth/step-up/verify',
      { challengeId, response: owner.passkey.assert({ challenge: request.challenge, origin }) },
      { cookie: owner.cookie },
    );
    expect(verified.status).toBe(200);
    const otherNonce = randomBytes(16).toString('base64url');
    expect((await kit({ 'arca-step-up-nonce': otherNonce })).status).toBe(403);
    const replaced = await kit({ 'arca-step-up-nonce': nonce });
    expect(replaced.status).toBe(200);
    const { code: second } = (await replaced.json()) as { code: string };
    expect(second).not.toBe(first);
    const [row] = await kitRows();
    expect(row?.code_hash).toEqual(recoveryCodeHash(row?.salt ?? Buffer.alloc(0), second));
    expect(row?.code_hash).not.toEqual(recoveryCodeHash(row?.salt ?? Buffer.alloc(0), first));
    expect(row?.confirmed_at).toBeNull();
    // The step-up is spent.
    expect((await kit({ 'arca-step-up-nonce': nonce })).status).toBe(403);
    const notices = (await outbox()).filter((entry) => !entry.text.includes('/enroll#'));
    expect(notices.map((entry) => entry.subject)).toEqual(['Novo kit de recuperação']);
    const events = await app.request('/v1/audit/events', { headers: { cookie: owner.cookie } });
    const { events: recorded } = (await events.json()) as { events: { code: string }[] };
    expect(recorded.map((event) => event.code)).toContain('recovery_kit_regenerated');
  });
});

describe('after the only account is erased', () => {
  it('keeps the spent code closed', async () => {
    await testDatabase.asAdmin((client) => client.query('DELETE FROM auth.user'));
    expect(await accountCount()).toBe(0);
    expect((await enrollOwner()).status).toBe(404);
  });
});
