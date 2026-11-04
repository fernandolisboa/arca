import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PasskeyCreationOptions } from '@arca/api-contract/routes';
import { createI18n } from '@arca/i18n';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from '../../src/app.js';
import { auditLog, auditReader } from '../../src/audit/log.js';
import { createAuth, credentialStore } from '../../src/auth/auth.js';
import { createEnrollment, ownerCode } from '../../src/auth/enrollment.js';
import { createInvites } from '../../src/auth/invites.js';
import { recoveryCodeHash, recoveryKits } from '../../src/auth/recovery-kit.js';
import { registration, registrationHooks } from '../../src/auth/registration.js';
import { authService } from '../../src/auth/service.js';
import { createStepUp } from '../../src/auth/step-up.js';
import { unconfiguredSender } from '../../src/email/email.js';
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
  const invites = createInvites({
    db: authDb,
    audit,
    email,
    notices,
    i18n,
    origin,
    logger: silentLogger,
  });
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
    registration: registration(auth, hooks, matching, silentLogger, invites.accepted),
    recoveryKits: recoveryKits({ db: authDb, audit, notices, logger: silentLogger }),
    invites,
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

/** The token of the newest link to a page, read from the fragment as the web app would. */
async function latestToken(page: 'enroll' | 'invite' = 'enroll'): Promise<string> {
  const [message] = (await outbox()).filter((entry) => entry.text.includes(`/${page}#`));
  const token = new RegExp(`/${page}#([A-Za-z0-9_-]+)`).exec(message?.text ?? '')?.[1];
  if (token === undefined) throw new Error(`no ${page} link in the outbox`);
  return token;
}

/** Null sends no code at all. */
const options = (token: string, typed: string | null = code) =>
  post('/v1/auth/registration/options', typed === null ? { token } : { token, code: typed });

interface Completion {
  readonly passkey?: SoftwarePasskey;
  /** Null sends no code, as an invite's page does. */
  readonly typed?: string | null;
  readonly userVerified?: boolean;
  readonly prfEnabled?: boolean;
}

/** Options, a new passkey's attestation, then verify, as the enrollment page makes them. */
async function register(
  token: string,
  { passkey = softwarePasskey(rpId), typed = code, userVerified, prfEnabled }: Completion = {},
) {
  const offered = await options(token, typed === null ? null : code);
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
    typed === null ? { token, response } : { token, code: typed, response },
    { cookie: cookiesFrom(offered) },
  );
  return { creation, passkey, verified };
}

/** A verified `sensitive_settings` step-up for one action; returns its nonce. */
async function stepUp(
  signedIn: { readonly cookie: string; readonly passkey: SoftwarePasskey },
  action: string,
  targets: readonly string[],
): Promise<string> {
  const nonce = randomBytes(16).toString('base64url');
  const challenge = await post(
    '/v1/auth/step-up/options',
    { purpose: 'sensitive_settings', target: { action, targets, nonce } },
    { cookie: signedIn.cookie },
  );
  const { challengeId, options: request } = (await challenge.json()) as {
    challengeId: string;
    options: { challenge: string };
  };
  const verified = await post(
    '/v1/auth/step-up/verify',
    { challengeId, response: signedIn.passkey.assert({ challenge: request.challenge, origin }) },
    { cookie: signedIn.cookie },
  );
  expect(verified.status).toBe(200);
  return nonce;
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

  it('keeps no address when there is no sending domain', async () => {
    const withoutEmail = createEnrollment({
      db: testDatabase.authDb,
      email: unconfiguredSender,
      i18n: await createI18n(),
      origin,
      ownerCode: ownerCode(codeHash),
    });
    expect(await withoutEmail.enrollOwner({ code, email: ownerEmail })).toBe('email_unavailable');
    const contexts = await testDatabase.asAdmin(
      async (client) => (await client.query('SELECT FROM auth.registration_context')).rowCount,
    );
    expect(contexts).toBe(0);
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
    // Recorded before the commit, so the event outlives the rolled-back account.
    const events = await testDatabase.asAdmin(async (client) => {
      const result = await client.query<{ code: string }>('SELECT code FROM audit.event');
      return result.rows;
    });
    expect(events).toEqual([{ code: 'owner_enrolled' }]);
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
    const nonce = await stepUp(owner, 'regenerateRecoveryKit', []);
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

describe('invites (spec 0003, R2)', () => {
  const invitee = 'invitee@example.org';
  let guest: { cookie: string; passkey: SoftwarePasskey };
  let inviteId: string;

  const invite = (cookie: string, email = invitee) => post('/v1/invites', { email }, { cookie });
  const listed = async (cookie: string) =>
    (
      (await (await app.request('/v1/invites', { headers: { cookie } })).json()) as {
        invites: { id: string; email: string; status: string }[];
      }
    ).invites;
  const details = (token: string) => post('/v1/invites/details', { token });
  const decide = (
    decision: 'confirm' | 'decline',
    id: string,
    headers: Record<string, string> = {},
  ) => post(`/v1/invites/${decision}`, { inviteId: id }, { cookie: owner.cookie, ...headers });
  const eventCodes = async (cookie: string) =>
    (
      (await (await app.request('/v1/audit/events', { headers: { cookie } })).json()) as {
        events: { code: string }[];
      }
    ).events.map((event) => event.code);

  it('emails a link that carries the token only in its fragment and never names the inviter', async () => {
    const sent = await invite(owner.cookie, 'Invitee@Example.org');
    expect(sent.status).toBe(200);
    const [message] = await outbox();
    expect(message?.to).toBe(invitee);
    expect(message?.text).toContain(`${origin}/invite#`);
    expect(message?.text).not.toContain(ownerEmail);
    const token = await latestToken('invite');
    const stored = await testDatabase.asAdmin(
      async (client) =>
        (await client.query<{ token_hash: Buffer }>('SELECT token_hash FROM auth.invite')).rows,
    );
    expect(stored).toEqual([{ token_hash: createHash('sha256').update(token).digest() }]);
    const [open] = await listed(owner.cookie);
    expect(open).toMatchObject({ email: invitee, status: 'open' });
    inviteId = open?.id ?? '';
    expect(await eventCodes(owner.cookie)).toContain('invite_created');
  });

  it('shows who sent a live link, and nothing for a forged one', async () => {
    const shown = await details(await latestToken('invite'));
    expect(await shown.json()).toEqual({ inviterEmail: ownerEmail });
    expect((await details(randomBytes(32).toString('base64url'))).status).toBe(404);
  });

  it('registers the invitee with no code, unconfirmed, and tells the inviter', async () => {
    const token = await latestToken('invite');
    const { passkey, verified } = await register(token, { typed: null });
    expect(verified.status).toBe(200);
    guest = { cookie: cookiesFrom(verified), passkey };
    const session = await app.request('/v1/session', { headers: { cookie: guest.cookie } });
    expect(await session.json()).toMatchObject({ email: invitee, confirmed: false });
    expect((await listed(owner.cookie))[0]).toMatchObject({ id: inviteId, status: 'accepted' });
    const [notice] = await outbox();
    expect(notice).toMatchObject({ to: ownerEmail, subject: 'Seu convite foi aceito' });
    expect(notice?.text).not.toContain(invitee);
    expect(await eventCodes(owner.cookie)).toContain('invite_accepted');
  });

  it('spends the invite', async () => {
    const token = await latestToken('invite');
    expect((await options(token, null)).status).toBe(404);
    expect((await details(token)).status).toBe(404);
  });

  it('refuses invites from an account not yet confirmed', async () => {
    const refused = await invite(guest.cookie, 'someone@example.org');
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: { code: 'account_unconfirmed' } });
  });

  it('never lets the invited account decide on itself', async () => {
    for (const decision of ['confirm', 'decline'] as const) {
      const nonce = await stepUp(guest, `${decision}Invite`, [inviteId]);
      const own = await post(
        `/v1/invites/${decision}`,
        { inviteId },
        { cookie: guest.cookie, 'arca-step-up-nonce': nonce },
      );
      expect(own.status).toBe(404);
    }
    const session = await app.request('/v1/session', { headers: { cookie: guest.cookie } });
    expect(await session.json()).toMatchObject({ confirmed: false });
    expect(await accountCount()).toBe(2);
  });

  it('opens no registration for an address that already has an account', async () => {
    expect((await invite(owner.cookie, ownerEmail)).status).toBe(200);
    expect((await options(await latestToken('invite'), null)).status).toBe(404);
  });

  it('confirms the account only after a step-up for that invite', async () => {
    expect((await decide('confirm', inviteId)).status).toBe(403);
    const elsewhere = await stepUp(owner, 'confirmInvite', [randomUUID()]);
    expect((await decide('confirm', inviteId, { 'arca-step-up-nonce': elsewhere })).status).toBe(
      403,
    );
    const declineNonce = await stepUp(owner, 'declineInvite', [inviteId]);
    expect((await decide('confirm', inviteId, { 'arca-step-up-nonce': declineNonce })).status).toBe(
      403,
    );
    const nonce = await stepUp(owner, 'confirmInvite', [inviteId]);
    expect((await decide('confirm', inviteId, { 'arca-step-up-nonce': nonce })).status).toBe(200);
    const session = await app.request('/v1/session', { headers: { cookie: guest.cookie } });
    expect(await session.json()).toMatchObject({ confirmed: true });
    const decided = (await listed(owner.cookie)).find((entry) => entry.id === inviteId);
    expect(decided).toMatchObject({ status: 'confirmed' });
    expect(await eventCodes(owner.cookie)).toContain('invite_confirmed');
    // A confirmed account cannot be confirmed or declined again.
    const again = await stepUp(owner, 'declineInvite', [inviteId]);
    expect((await decide('decline', inviteId, { 'arca-step-up-nonce': again })).status).toBe(404);
  });

  it('lets a confirmed invitee invite in turn', async () => {
    expect((await invite(guest.cookie, 'cousin@example.org')).status).toBe(200);
  });

  it('erases a declined account and frees its address', async () => {
    const declined = 'declined@example.org';
    expect((await invite(owner.cookie, declined)).status).toBe(200);
    const { verified } = await register(await latestToken('invite'), { typed: null });
    expect(verified.status).toBe(200);
    const pending = (await listed(owner.cookie)).find((entry) => entry.email === declined);
    const id = pending?.id ?? '';
    const nonce = await stepUp(owner, 'declineInvite', [id]);
    expect((await decide('decline', id, { 'arca-step-up-nonce': nonce })).status).toBe(200);
    const left = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ users: number; invites: number }>(
            `SELECT (SELECT count(*)::int FROM auth.user WHERE email = $1) AS users,
                    (SELECT count(*)::int FROM auth.invite WHERE email = $1) AS invites`,
            [declined],
          )
        ).rows[0],
    );
    expect(left).toEqual({ users: 0, invites: 0 });
    expect(await eventCodes(owner.cookie)).toContain('invite_declined');
    expect((await invite(owner.cookie, declined)).status).toBe(200);
  });

  it('keeps at most 10 open invites per account, a new one to an address replacing the last', async () => {
    const before = (await listed(owner.cookie)).filter((entry) => entry.status === 'open').length;
    for (let index = before; index < 10; index += 1) {
      expect((await invite(owner.cookie, `family-${String(index)}@example.org`)).status).toBe(200);
    }
    const over = await invite(owner.cookie, 'one-too-many@example.org');
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: { code: 'too_many_invites' } });
    expect((await invite(owner.cookie, 'family-9@example.org')).status).toBe(200);
  });

  it('expires an invite after 48 hours, with an event', async () => {
    const token = await latestToken('invite');
    await testDatabase.asAdmin((client) =>
      client.query(
        "UPDATE auth.invite SET expires_at = now() - interval '1 second' WHERE accepted_at IS NULL",
      ),
    );
    expect((await details(token)).status).toBe(404);
    expect((await invite(owner.cookie, 'later@example.org')).status).toBe(200);
    const open = (await listed(owner.cookie)).filter((entry) => entry.status === 'open');
    expect(open.map((entry) => entry.email)).toEqual(['later@example.org']);
    expect(await eventCodes(owner.cookie)).toContain('invite_expired');
  });
});

describe('after the only account is erased', () => {
  it('keeps the spent code closed', async () => {
    await testDatabase.asAdmin((client) => client.query('DELETE FROM auth.user'));
    expect(await accountCount()).toBe(0);
    expect((await enrollOwner()).status).toBe(404);
  });
});
