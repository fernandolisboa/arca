import { createI18n } from '@arca/i18n';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/audit/log.js';
import { createDevices, type Devices } from '../../src/auth/devices.js';
import { recoveryKits, type RecoveryKits } from '../../src/auth/recovery-kit.js';
import { createRecovery, recoveryAttempts, type Recovery } from '../../src/auth/recovery.js';
import type { EmailMessage } from '../../src/email/email.js';
import type { Notice } from '../../src/email/notices.js';
import { softwarePasskey } from '../software-passkey.js';
import { accountFixtures, type Account } from './accounts.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';

// Account recovery on the real migrations and the app_auth pool (spec 0003, R6). Synthetic
// data only.
const origin = 'http://localhost:3000';
const rpId = 'localhost';
const device = { browser: 'firefox', os: 'linux' } as const;

let testDatabase: AuthTestDatabase;
let fixtures: ReturnType<typeof accountFixtures>;
let devices: Devices;
let kits: RecoveryKits;
let recovery: Recovery;
const mail: EmailMessage[] = [];
const sent: Notice[] = [];
const floors: number[] = [];

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  fixtures = accountFixtures(testDatabase, rpId);
  const { authDb: db, auditDb } = testDatabase;
  const audit = auditLog(auditDb);
  const notices = {
    send: (notice: Notice) => {
      sent.push(notice);
      return Promise.resolve();
    },
  };
  devices = createDevices({ db, audit, notices, logger: silentLogger, origin });
  kits = recoveryKits({ db, audit, notices, logger: silentLogger });
  recovery = createRecovery({
    db,
    audit,
    email: {
      send: (message) => {
        mail.push(message);
        return Promise.resolve();
      },
    },
    notices,
    i18n: await createI18n(),
    origin,
    logger: silentLogger,
    emailAvailable: true,
    status: devices.status,
    sleep: (ms) => {
      floors.push(ms);
      return Promise.resolve();
    },
  });
});

afterAll(async () => {
  await testDatabase.drop();
});

beforeEach(() => {
  floors.length = 0;
});

/** An account with one passkey, a session it signed in and a recovery code the owner kept. */
async function owner() {
  const account = await fixtures.account(1);
  const signedIn = await fixtures.session(account, account.keys[0]);
  const code = await kits.regenerate(account.accountId);
  return { account, signedIn, code };
}

const mailTo = (account: Account) => mail.filter(({ to }) => to === account.email);
const noticesTo = (account: Account) =>
  sent.filter(({ to }) => to === account.email).map(({ kind }) => kind);

/** Starts recovery and reads the token from the fragment of the emailed link. */
async function linkFor(account: Account) {
  expect(await recovery.start(account.email)).toBe('accepted');
  const text = mailTo(account).at(-1)?.text ?? '';
  const token = /\/recover#([\w-]+)/.exec(text)?.[1];
  expect(token).toBeDefined();
  return token ?? '';
}

/** Registers a new software passkey on a redeemed link. */
async function registered(token: string) {
  const options = await recovery.options(token);
  expect(options).not.toBeNull();
  const passkey = softwarePasskey(rpId);
  const response = passkey.attest({ challenge: options?.challenge ?? '', origin });
  expect(await recovery.verify(token, response, device)).toBe('registered');
  return passkey;
}

const linksOf = (account: Account) =>
  fixtures.count('SELECT count(*)::int AS n FROM auth.recovery_link WHERE account_id = $1', [
    account.accountId,
  ]);

/** The link ends early, as when its page was closed; a provisional code keeps its own end. */
const linkClosed = (account: Account) =>
  testDatabase.asAdmin((client) =>
    client.query('DELETE FROM auth.recovery_link WHERE account_id = $1', [account.accountId]),
  );

/** Moves the account's link and any provisional code past their end. */
const linkExpired = (account: Account) =>
  testDatabase.asAdmin(async (client) => {
    await client.query(
      `UPDATE auth.recovery_link SET expires_at = now() - interval '1 second' WHERE account_id = $1`,
      [account.accountId],
    );
    await client.query(
      `UPDATE auth.recovery_code SET provisional_until = now() - interval '1 second'
        WHERE account_id = $1 AND provisional_until IS NOT NULL`,
      [account.accountId],
    );
  });

describe('starting recovery (spec 0003, R6)', () => {
  it('emails a link to an account and answers the same for an unknown address', async () => {
    const { account } = await owner();
    expect(await recovery.start(account.email.toUpperCase())).toBe('accepted');
    expect(await recovery.start('nobody@example.com')).toBe('accepted');
    expect(floors).toEqual([1500, 1500]);
    expect(mail.filter(({ to }) => to === 'nobody@example.com')).toEqual([]);
    const [message] = mailTo(account);
    expect(message?.text).toContain(`${origin}/recover#`);
    expect(noticesTo(account)).toContain('recovery_started');
    expect(await fixtures.events(account, ['recovery_started'])).toEqual([
      { code: 'recovery_started', actor: null, details: {} },
    ]);
  });

  it('keeps one link per account, the latest', async () => {
    const { account, code } = await owner();
    const first = await linkFor(account);
    const second = await linkFor(account);
    expect(await linksOf(account)).toBe(1);
    expect(await recovery.redeem(first, code)).toEqual({ ok: false, reason: 'not_found' });
    expect((await recovery.redeem(second, code)).ok).toBe(true);
  });

  it('sends nothing to an account without a recovery code', async () => {
    const account = await fixtures.account(1);
    await recovery.start(account.email);
    expect(mailTo(account)).toEqual([]);
  });

  it('answers email_unavailable where no email can be sent, whoever asks', async () => {
    const closed = createRecovery({
      db: testDatabase.authDb,
      audit: auditLog(testDatabase.auditDb),
      email: { send: () => Promise.reject(new Error('unused')) },
      notices: { send: () => Promise.reject(new Error('unused')) },
      i18n: await createI18n(),
      origin,
      logger: silentLogger,
      emailAvailable: false,
      status: devices.status,
    });
    expect(await closed.start('nobody@example.com')).toBe('email_unavailable');
  });

  it('does not replace a link whose code was accepted', async () => {
    const { account, code } = await owner();
    const token = await linkFor(account);
    expect((await recovery.redeem(token, code)).ok).toBe(true);
    const before = mailTo(account).length;
    await recovery.start(account.email);
    expect(mailTo(account)).toHaveLength(before);
    await registered(token);
  });
});

describe('redeeming the code (spec 0003, R6)', () => {
  it('needs the link and the code together, each once', async () => {
    const { account, code } = await owner();
    expect(await recovery.redeem('A'.repeat(43), code)).toEqual({ ok: false, reason: 'not_found' });
    const token = await linkFor(account);
    const typed = `${code.slice(0, 5).toLowerCase()} ${code.slice(5)}`;
    const outcome = await recovery.redeem(token, typed);
    expect(outcome.ok).toBe(true);
    expect(await recovery.redeem(token, code)).toEqual({ ok: false, reason: 'not_found' });
    // The old code is spent: a new link does not take it.
    const issued = outcome.ok ? outcome.code : '';
    expect(issued).not.toBe(code);
    await linkClosed(account);
    const again = await linkFor(account);
    expect(await recovery.redeem(again, code)).toEqual({ ok: false, reason: 'invalid_code' });
  });

  it('refuses an expired link', async () => {
    const { account, code } = await owner();
    const token = await linkFor(account);
    await linkExpired(account);
    expect(await recovery.redeem(token, code)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('locks recovery for a day after five wrong codes, with a notice', async () => {
    const { account, code } = await owner();
    const token = await linkFor(account);
    for (let attempt = 1; attempt < recoveryAttempts; attempt += 1) {
      expect(await recovery.redeem(token, 'WRONG')).toEqual({ ok: false, reason: 'invalid_code' });
    }
    expect(await recovery.redeem(token, 'WRONG')).toEqual({ ok: false, reason: 'locked' });
    expect(noticesTo(account)).toContain('recovery_locked');
    expect(await fixtures.events(account, ['recovery_failed'])).toHaveLength(recoveryAttempts);
    expect(await recovery.redeem(token, code)).toEqual({ ok: false, reason: 'not_found' });
    const before = mailTo(account).length;
    await recovery.start(account.email);
    expect(mailTo(account)).toHaveLength(before);
    const lockedUntil = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ hours: number }>(
            `SELECT extract(epoch FROM locked_until - now()) / 3600 AS hours
               FROM auth.recovery_lock WHERE account_id = $1`,
            [account.accountId],
          )
        ).rows[0]?.hours,
    );
    expect(Number(lockedUntil)).toBeGreaterThan(23.9);
  });

  it('counts wrong codes across links and resets them on the right one', async () => {
    const { account, code } = await owner();
    const first = await linkFor(account);
    await recovery.redeem(first, 'WRONG');
    const second = await linkFor(account);
    await recovery.redeem(second, 'WRONG');
    const failures = () =>
      fixtures.count('SELECT failures AS n FROM auth.recovery_lock WHERE account_id = $1', [
        account.accountId,
      ]);
    expect(await failures()).toBe(2);
    expect((await recovery.redeem(second, code)).ok).toBe(true);
    expect(await failures()).toBe(0);
  });

  it('keeps the new code only until the link ends unless the passkey registers', async () => {
    const { account, code } = await owner();
    const token = await linkFor(account);
    const outcome = await recovery.redeem(token, code);
    expect(await kits.status(account.accountId)).toBe('unsaved');
    await linkExpired(account);
    expect(await kits.status(account.accountId)).toBe('none');
    // Neither code opens recovery any more: the old one was spent, the new one lapsed.
    const before = mailTo(account).length;
    await recovery.start(account.email);
    expect(mailTo(account)).toHaveLength(before);
    expect(outcome.ok).toBe(true);
  });

  it('lets the owner retry with the new code inside the window', async () => {
    const { account, code } = await owner();
    const first = await linkFor(account);
    const outcome = await recovery.redeem(first, code);
    const issued = outcome.ok ? outcome.code : '';
    await linkClosed(account);
    const second = await linkFor(account);
    expect((await recovery.redeem(second, issued)).ok).toBe(true);
  });
});

describe('registering the recovery passkey (spec 0003, R6)', () => {
  it('stores it pending, keeps the new code, records it and opens no session', async () => {
    const { account, signedIn, code } = await owner();
    const token = await linkFor(account);
    const outcome = await recovery.redeem(token, code);
    expect(await recovery.options('B'.repeat(43))).toBeNull();
    const passkey = await registered(token);
    const [pending] = await fixtures.pendingOf(account);
    expect(pending).toMatchObject({ credentialId: passkey.credentialId, recovery: true });
    expect(await fixtures.sessionsOf(account)).toEqual([signedIn.sessionId]);
    expect(await linksOf(account)).toBe(0);
    await linkExpired(account);
    expect(await kits.status(account.accountId)).toBe('unsaved');
    expect(await fixtures.events(account, ['passkey_added', 'recovery_completed'])).toEqual([
      { code: 'passkey_added', actor: null, details: { passkeyId: pending?.id } },
      { code: 'recovery_completed', actor: null, details: {} },
    ]);
    expect(noticesTo(account)).toContain('recovery_completed');
    const client = await testDatabase.asAdmin(
      async (admin) =>
        (
          await admin.query<{ browser: string; os: string }>(
            'SELECT browser, os FROM auth.passkey_client WHERE credential_id = $1',
            [passkey.credentialId],
          )
        ).rows[0],
    );
    expect(client).toEqual(device);
    expect(outcome.ok).toBe(true);
  });

  it('refuses options before the code is accepted', async () => {
    const { account } = await owner();
    expect(await recovery.options(await linkFor(account))).toBeNull();
  });

  it('spends the challenge on its first attempt', async () => {
    const { account, code } = await owner();
    const token = await linkFor(account);
    await recovery.redeem(token, code);
    const options = await recovery.options(token);
    const wrongOrigin = softwarePasskey(rpId).attest({
      challenge: options?.challenge ?? '',
      origin: 'http://elsewhere.example.org',
    });
    expect(await recovery.verify(token, wrongOrigin, device)).toBe('refused');
    const replay = softwarePasskey(rpId).attest({ challenge: options?.challenge ?? '', origin });
    expect(await recovery.verify(token, replay, device)).toBe('refused');
    await registered(token);
  });

  it('refuses a passkey on a link that ended', async () => {
    const { account, code } = await owner();
    const token = await linkFor(account);
    await recovery.redeem(token, code);
    const options = await recovery.options(token);
    await linkExpired(account);
    const response = softwarePasskey(rpId).attest({ challenge: options?.challenge ?? '', origin });
    expect(await recovery.verify(token, response, device)).toBe('not_found');
  });
});

describe('the wait of a recovery passkey (spec 0003, R6)', () => {
  async function recovered() {
    const started = await owner();
    const token = await linkFor(started.account);
    await recovery.redeem(token, started.code);
    await registered(token);
    return started;
  }

  it('restricts every session and refuses a new recovery meanwhile', async () => {
    const { account } = await recovered();
    expect(await devices.status(account.accountId)).toMatchObject({ recoveryPending: true });
    const before = mailTo(account).length;
    await recovery.start(account.email);
    expect(mailTo(account)).toHaveLength(before);
  });

  it('ends the restricted sessions once the passkey activates', async () => {
    const { account } = await recovered();
    await fixtures.waitOver(account);
    const later = await fixtures.session(account, account.keys[0], { age: '0 seconds' });
    expect(await devices.status(account.accountId)).toMatchObject({
      recoveryPending: false,
      sessionsEnded: true,
    });
    expect(await fixtures.sessionsOf(account)).toEqual([later.sessionId]);
    expect(await fixtures.events(account, ['passkey_activated'])).toHaveLength(1);
  });

  it('lets a session change nothing else meanwhile, not even another passkey', async () => {
    const { account, signedIn } = await recovered();
    const [kept] = account.keys;
    expect(await devices.revokePasskey(signedIn, kept.id)).toBe('recovery_pending');
    expect(await fixtures.events(account, ['passkey_revoked'])).toEqual([]);
  });

  it('cancelling it deletes the recovery code, which closes recovery', async () => {
    const { account, signedIn } = await recovered();
    const [pending] = await fixtures.pendingOf(account);
    expect(await devices.revokePasskey(signedIn, pending?.id ?? '')).toBe('revoked');
    expect(await devices.status(account.accountId)).toMatchObject({ recoveryPending: false });
    expect(await kits.status(account.accountId)).toBe('none');
    expect(await fixtures.events(account, ['recovery_cancelled'])).toEqual([
      { code: 'recovery_cancelled', actor: account.accountId, details: {} },
    ]);
    const before = mailTo(account).length;
    await recovery.start(account.email);
    expect(mailTo(account)).toHaveLength(before);
  });

  it('keeps an old code from opening a second recovery', async () => {
    const { account, code } = await recovered();
    await fixtures.waitOver(account);
    await devices.status(account.accountId);
    const token = await linkFor(account);
    expect(await recovery.redeem(token, code)).toEqual({ ok: false, reason: 'invalid_code' });
  });
});
