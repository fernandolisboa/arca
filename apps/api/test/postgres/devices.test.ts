import { randomBytes, randomUUID } from 'node:crypto';
import type { StepUpOptionsRequest } from '@arca/api-contract/routes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/audit/log.js';
import { credentialStore } from '../../src/auth/auth.js';
import { createDevices, type Devices } from '../../src/auth/devices.js';
import type { SignedIn } from '../../src/auth/service.js';
import { createStepUp, type StepUpService } from '../../src/auth/step-up.js';
import { softwarePasskey, type SoftwarePasskey } from '../software-passkey.js';
import { accountFixtures, type Account, type Key } from './accounts.js';
import { recordingNotifier } from '../notifications.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';

// The device list and its revocations on the real migrations and the app_auth pool (spec 0003,
// R4). Synthetic data only.
const origin = 'http://localhost:3000';
const rpId = 'localhost';
/** No vault in these tests: nothing to delete before a revocation. */
const noVault = () => Promise.resolve();

let testDatabase: AuthTestDatabase;
let fixtures: ReturnType<typeof accountFixtures>;
let devices: Devices;
let stepUp: StepUpService;
const notified = recordingNotifier();
const logged: string[] = [];

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  fixtures = accountFixtures(testDatabase, rpId);
  const { authDb, auditDb } = testDatabase;
  const audit = auditLog(auditDb);
  devices = createDevices({
    db: authDb,
    audit,
    notifier: notified.notifier,
    logger: {
      info: () => undefined,
      error: ({ errorName }) => {
        logged.push(String(errorName));
      },
    },
    origin,
  });
  stepUp = createStepUp({
    db: authDb,
    credentials: credentialStore(authDb),
    audit,
    origin,
    logger: silentLogger,
  });
});

afterAll(async () => {
  await testDatabase.drop();
});

const account = (passkeys?: number) => fixtures.account(passkeys);
const session = (...args: Parameters<typeof fixtures.session>) => fixtures.session(...args);
const events = (owner: Account, codes = ['passkey_revoked', 'session_revoked']) =>
  fixtures.events(owner, codes);

const noticesTo = (owner: Account) => notified.to(owner.accountId);

/** A verified step-up of this purpose for this session, signed by the key. */
async function verifiedStepUp(signedIn: SignedIn, key: Key, request: StepUpOptionsRequest) {
  const { challengeId, options } = await stepUp.options(signedIn, request);
  const response = key.passkey.assert({ challenge: options.challenge, origin });
  expect(await stepUp.verify(signedIn, challengeId, response)).toBe(true);
}

const sensitive = (action: string): StepUpOptionsRequest => ({
  purpose: 'sensitive_settings',
  target: { action, targets: [], nonce: randomBytes(16).toString('base64url') },
});

describe('the device list (spec 0003, R4)', () => {
  it("lists the account's passkeys oldest first, each with its live sessions", async () => {
    const owner = await account();
    const [older, newer] = owner.keys as [Key, Key];
    const current = await session(owner, newer, { idle: '1 minute' });
    const elsewhere = await session(owner, older, { age: '3 hours', idle: '2 hours' });
    await session(owner, older, { expiresIn: '-1 second' });
    await session(owner, older, { age: '30 days 1 minute', idle: '1 minute' });
    const stranger = await account(1);
    await session(stranger, stranger.keys[0]);

    const listed = await devices.list(current);
    expect(listed.passkeys.map(({ id, current: here }) => [id, here])).toEqual([
      [older.id, false],
      [newer.id, true],
    ]);
    expect(listed.passkeys.map(({ sessions }) => sessions.map(({ id }) => id))).toEqual([
      [elsewhere.sessionId],
      [current.sessionId],
    ]);
    expect(listed.passkeys[1]?.sessions[0]).toMatchObject({
      device: { browser: 'chrome', os: 'android' },
      current: true,
    });
    const [shown] = listed.passkeys[0]?.sessions ?? [];
    expect(Date.parse(shown?.lastUsedAt ?? '')).toBeGreaterThan(Date.parse(shown?.createdAt ?? ''));
  });
});

describe('revoking a session (spec 0003, R4)', () => {
  it("ends one of the account's sessions, with an event", async () => {
    const owner = await account(1);
    const key = owner.keys[0];
    const current = await session(owner, key);
    const other = await session(owner, key);
    expect(await devices.revokeSession(current, other.sessionId)).toBe(true);
    expect(await fixtures.sessionsOf(owner)).toEqual([current.sessionId]);
    expect(await events(owner)).toEqual([
      {
        code: 'session_revoked',
        actor: owner.accountId,
        details: { sessionId: other.sessionId },
      },
    ]);
  });

  it("leaves another account's session alone", async () => {
    const owner = await account(1);
    const current = await session(owner, owner.keys[0]);
    const stranger = await account(1);
    const theirs = await session(stranger, stranger.keys[0]);
    expect(await devices.revokeSession(current, theirs.sessionId)).toBe(false);
    expect(await devices.revokeSession(current, randomUUID())).toBe(false);
    expect(await fixtures.sessionsOf(stranger)).toEqual([theirs.sessionId]);
    expect(await events(owner)).toEqual([]);
  });
});

describe('revoking a passkey (spec 0003, R4)', () => {
  it('ends the sessions it signed in and keeps those of another passkey', async () => {
    const owner = await account();
    const [older, newer] = owner.keys as [Key, Key];
    const current = await session(owner, newer);
    await session(owner, older);
    await session(owner, older);
    expect(await devices.revokePasskey(current, older.id, noVault)).toBe('revoked');
    expect(await fixtures.sessionsOf(owner)).toEqual([current.sessionId]);
    expect(
      await fixtures.count(
        'SELECT count(*)::int AS n FROM auth.passkey_client WHERE credential_id = $1',
        [older.passkey.credentialId],
      ),
    ).toBe(0);
    expect(await events(owner)).toEqual([
      {
        code: 'passkey_revoked',
        actor: owner.accountId,
        details: { passkeyId: older.id, pending: false },
      },
    ]);
    expect(noticesTo(owner)).toEqual(['passkey_revoked']);
    const listed = await devices.list(current);
    expect(listed.passkeys.map(({ id }) => id)).toEqual([newer.id]);
  });

  it('ends what it approved and nothing spent yet, in any session, and keeps what was spent', async () => {
    const owner = await account();
    const [older, newer] = owner.keys as [Key, Key];
    const current = await session(owner, newer);
    // Another session that the older passkey did not sign in, where it still approved things.
    const elsewhere = await session(owner, newer);
    await verifiedStepUp(elsewhere, older, { purpose: 'vault_unlock' });
    await verifiedStepUp(elsewhere, older, sensitive('regenerateRecoveryKit'));
    await verifiedStepUp(elsewhere, older, sensitive('confirmInvite'));
    await testDatabase.asAdmin((client) =>
      client.query(
        `UPDATE auth.step_up SET consumed_at = now()
          WHERE account_id = $1 AND subject_hash = (
            SELECT subject_hash FROM auth.step_up WHERE account_id = $1 AND purpose = 'sensitive_settings'
             ORDER BY verified_at LIMIT 1)`,
        [owner.accountId],
      ),
    );
    await verifiedStepUp(elsewhere, newer, sensitive('regenerateRecoveryKit'));
    expect(await stepUp.vaultUnlocked(elsewhere)).toBe(true);

    expect(await devices.revokePasskey(current, older.id, noVault)).toBe('revoked');
    expect(await stepUp.vaultUnlocked(elsewhere)).toBe(false);
    const left = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ credential_id: string; spent: boolean }>(
            `SELECT credential_id, consumed_at IS NOT NULL AS spent FROM auth.step_up
              WHERE account_id = $1 ORDER BY verified_at`,
            [owner.accountId],
          )
        ).rows,
    );
    expect(left).toEqual([
      { credential_id: older.passkey.credentialId, spent: true },
      { credential_id: newer.passkey.credentialId, spent: false },
    ]);
  });

  it("ends the caller's own session when it removes the passkey that signed it in", async () => {
    const owner = await account();
    const [older, newer] = owner.keys as [Key, Key];
    const current = await session(owner, newer);
    const kept = await session(owner, older);
    expect(await devices.revokePasskey(current, newer.id, noVault)).toBe('revoked');
    expect(await fixtures.sessionsOf(owner)).toEqual([kept.sessionId]);
  });

  it('stands when its notice fails, and logs the failure', async () => {
    const owner = await account();
    const [older, newer] = owner.keys as [Key, Key];
    const current = await session(owner, newer);
    notified.failing = true;
    try {
      expect(await devices.revokePasskey(current, older.id, noVault)).toBe('revoked');
    } finally {
      notified.failing = false;
    }
    expect(
      await fixtures.count('SELECT count(*)::int AS n FROM auth.passkey WHERE user_id = $1', [
        owner.accountId,
      ]),
    ).toBe(1);
    expect(logged).toContain('DeviceNotice:Error');
  });

  it('refuses a step-up whose passkey is revoked before it is recorded', async () => {
    const owner = await account();
    const [older, newer] = owner.keys as [Key, Key];
    const current = await session(owner, newer);
    const real = credentialStore(testDatabase.authDb);
    // The passkey is found, then revoked before the verification records anything.
    const racing = createStepUp({
      db: testDatabase.authDb,
      credentials: {
        ...real,
        active: async (accountId, credentialId) => {
          const found = await real.active(accountId, credentialId);
          expect(await devices.revokePasskey(current, older.id, noVault)).toBe('revoked');
          return found;
        },
      },
      audit: auditLog(testDatabase.auditDb),
      origin,
      logger: silentLogger,
    });
    const { challengeId, options } = await racing.options(current, { purpose: 'vault_unlock' });
    const response = older.passkey.assert({ challenge: options.challenge, origin });
    expect(await racing.verify(current, challengeId, response)).toBe(false);
    expect(await racing.vaultUnlocked(current)).toBe(false);
    expect(
      await fixtures.count('SELECT count(*)::int AS n FROM auth.step_up WHERE account_id = $1', [
        owner.accountId,
      ]),
    ).toBe(0);
  });

  it('keeps the last passkey, and says so', async () => {
    const owner = await account(1);
    const key = owner.keys[0];
    const current = await session(owner, key);
    expect(await devices.revokePasskey(current, key.id, noVault)).toBe('last_active');
    expect(await fixtures.sessionsOf(owner)).toEqual([current.sessionId]);
    expect(await events(owner)).toEqual([]);
    expect(noticesTo(owner)).toEqual([]);
  });

  it('keeps one passkey when two revocations race', async () => {
    const owner = await account();
    const [older, newer] = owner.keys as [Key, Key];
    const first = await session(owner, older);
    const second = await session(owner, newer);
    const outcomes = await Promise.all([
      devices.revokePasskey(first, newer.id, noVault),
      devices.revokePasskey(second, older.id, noVault),
    ]);
    expect([...outcomes].sort()).toEqual(['last_active', 'revoked']);
    expect(
      await fixtures.count('SELECT count(*)::int AS n FROM auth.passkey WHERE user_id = $1', [
        owner.accountId,
      ]),
    ).toBe(1);
  });

  it('finds no passkey of another account, nor one that does not exist', async () => {
    const owner = await account();
    const current = await session(owner, owner.keys[0]);
    const stranger = await account();
    expect(await devices.revokePasskey(current, stranger.keys[0].id, noVault)).toBe('not_found');
    expect(await devices.revokePasskey(current, randomUUID(), noVault)).toBe('not_found');
    expect(
      await fixtures.count('SELECT count(*)::int AS n FROM auth.passkey WHERE user_id = $1', [
        stranger.accountId,
      ]),
    ).toBe(2);
  });
});

/** Resolves once some query on the test database waits for a lock; fails after 5 seconds. */
async function waitForBlockedQuery() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const blocked = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_catalog.pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'`,
          )
        ).rows[0]?.n ?? 0,
    );
    if (blocked > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('no query waited for a lock');
}

describe('a step-up and a revocation of its passkey at once (spec 0003, R4 and R5)', () => {
  it('makes the revocation wait for the step-up, then end it', async () => {
    const owner = await account();
    const [older, newer] = owner.keys as [Key, Key];
    const current = await session(owner, newer);
    const audit = auditLog(testDatabase.auditDb);
    let revocation: Promise<string> | undefined;
    // The revocation starts while the verification is recording, inside its transaction.
    const racing = createStepUp({
      db: testDatabase.authDb,
      credentials: credentialStore(testDatabase.authDb),
      audit: {
        ...audit,
        record: async (event) => {
          if (event.code === 'step_up_verified') {
            revocation = devices.revokePasskey(current, older.id, noVault);
            // Proves the revocation is waiting on the passkey row this verification holds.
            await waitForBlockedQuery();
          }
          await audit.record(event);
        },
      },
      origin,
      logger: silentLogger,
    });
    const { challengeId, options } = await racing.options(current, { purpose: 'vault_unlock' });
    const response = older.passkey.assert({ challenge: options.challenge, origin });
    expect(await racing.verify(current, challengeId, response)).toBe(true);
    expect(await revocation).toBe('revoked');
    expect(await racing.vaultUnlocked(current)).toBe(false);
  });
});

describe('signing out the other sessions (spec 0003, R4)', () => {
  it('leaves only the current session and sends one notice', async () => {
    const owner = await account();
    const [older, newer] = owner.keys as [Key, Key];
    const current = await session(owner, newer);
    const others = [await session(owner, older), await session(owner, newer)];
    const stranger = await account(1);
    const theirs = await session(stranger, stranger.keys[0]);
    await devices.revokeOtherSessions(current);
    expect(await fixtures.sessionsOf(owner)).toEqual([current.sessionId]);
    expect(await fixtures.sessionsOf(stranger)).toEqual([theirs.sessionId]);
    expect((await events(owner)).map(({ details }) => details)).toEqual(
      expect.arrayContaining(others.map(({ sessionId }) => ({ sessionId }))),
    );
    expect(noticesTo(owner)).toEqual(['sessions_revoked']);
  });

  it('ends dead sessions without recording or announcing them', async () => {
    const owner = await account(1);
    const key = owner.keys[0];
    const current = await session(owner, key);
    await session(owner, key, { expiresIn: '-1 second' });
    await session(owner, key, { age: '30 days 1 minute' });
    await devices.revokeOtherSessions(current);
    expect(await fixtures.sessionsOf(owner)).toEqual([current.sessionId]);
    expect(await events(owner)).toEqual([]);
    expect(noticesTo(owner)).toEqual([]);
  });

  it('sends nothing when there is no other session', async () => {
    const owner = await account(1);
    const current = await session(owner, owner.keys[0]);
    await devices.revokeOtherSessions(current);
    expect(await fixtures.sessionsOf(owner)).toEqual([current.sessionId]);
    expect(noticesTo(owner)).toEqual([]);
  });
});

/** Adds a new software passkey through the ceremony, as the device screen does. */
async function added(signedIn: SignedIn) {
  const { challengeId, options } = await devices.addOptions(signedIn);
  const passkey = softwarePasskey(rpId);
  const response = passkey.attest({ challenge: options.challenge, origin, prfEnabled: true });
  expect(await devices.add(signedIn, challengeId, response)).toBe(true);
  return passkey;
}

/** Whether a step-up signed by this key is accepted for the session. */
async function stepsUp(signedIn: SignedIn, passkey: SoftwarePasskey) {
  const { challengeId, options } = await stepUp.options(signedIn, { purpose: 'vault_unlock' });
  return stepUp.verify(
    signedIn,
    challengeId,
    passkey.assert({ challenge: options.challenge, origin }),
  );
}

describe('adding a passkey (spec 0003, R4)', () => {
  it('stores it pending for 24 hours, with an event and a notice, and opens no session', async () => {
    const owner = await account(1);
    const current = await session(owner, owner.keys[0]);
    const before = Date.now();
    await added(current);
    expect(await fixtures.sessionsOf(owner)).toEqual([current.sessionId]);
    const [pending] = await fixtures.pendingOf(owner);
    expect(await events(owner, ['passkey_added'])).toEqual([
      { code: 'passkey_added', actor: owner.accountId, details: { passkeyId: pending?.id } },
    ]);
    expect(noticesTo(owner)).toEqual(['passkey_added']);
    const listed = await devices.list(current);
    const shown = listed.passkeys.find(({ id }) => id === pending?.id);
    expect(shown).toMatchObject({ state: 'pending', current: false, sessions: [] });
    const activeFrom = Date.parse(shown?.activeFrom ?? '');
    expect(activeFrom - before).toBeGreaterThan(24 * 60 * 60 * 1000 - 60_000);
    expect(activeFrom - before).toBeLessThan(24 * 60 * 60 * 1000 + 60_000);
    expect((await devices.status(owner.accountId)).pendingUntil?.getTime()).toBe(activeFrom);
    expect(
      await fixtures.count(
        'SELECT count(*)::int AS n FROM auth.passkey_capability WHERE credential_id = $1 AND prf_enabled',
        [pending?.credentialId],
      ),
    ).toBe(1);
    // Seeded with the adding session's families, so a sign-in from any other one is announced.
    const families = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ browser: string; os: string }>(
            'SELECT browser, os FROM auth.passkey_client WHERE credential_id = $1',
            [pending?.credentialId],
          )
        ).rows,
    );
    expect(families).toEqual([{ browser: 'chrome', os: 'android' }]);
  });

  it('refuses an expired challenge, and one of another account', async () => {
    const owner = await account(1);
    const current = await session(owner, owner.keys[0]);
    const stranger = await account(1);
    const theirs = await session(stranger, stranger.keys[0]);
    const expired = await devices.addOptions(current);
    await testDatabase.asAdmin((client) =>
      client.query(
        `UPDATE auth.passkey_challenge SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [expired.challengeId],
      ),
    );
    const late = softwarePasskey(rpId).attest({ challenge: expired.options.challenge, origin });
    expect(await devices.add(current, expired.challengeId, late)).toBe(false);
    const issued = await devices.addOptions(current);
    const borrowed = softwarePasskey(rpId).attest({ challenge: issued.options.challenge, origin });
    expect(await devices.add(theirs, issued.challengeId, borrowed)).toBe(false);
    expect(await fixtures.pendingOf(owner)).toEqual([]);
    expect(await fixtures.pendingOf(stranger)).toEqual([]);
  });

  it('refuses a passkey for another relying party', async () => {
    const owner = await account(1);
    const current = await session(owner, owner.keys[0]);
    const { challengeId, options } = await devices.addOptions(current);
    const response = softwarePasskey('elsewhere.example.org').attest({
      challenge: options.challenge,
      origin,
    });
    expect(await devices.add(current, challengeId, response)).toBe(false);
    expect(await fixtures.pendingOf(owner)).toEqual([]);
  });

  it('refuses a credential already stored, for this account or another, with no event', async () => {
    const owner = await account(1);
    const current = await session(owner, owner.keys[0]);
    const stranger = await account(1);
    for (const held of [owner.keys[0], stranger.keys[0]]) {
      const { challengeId, options } = await devices.addOptions(current);
      const response = held.passkey.attest({ challenge: options.challenge, origin });
      expect(await devices.add(current, challengeId, response)).toBe(false);
    }
    expect(await fixtures.pendingOf(owner)).toEqual([]);
    expect(await events(owner, ['passkey_added'])).toEqual([]);
    expect(noticesTo(owner)).toEqual([]);
    expect(
      await fixtures.count('SELECT count(*)::int AS n FROM auth.passkey WHERE user_id = $1', [
        stranger.accountId,
      ]),
    ).toBe(1);
  });

  it('asks the browser not to register a passkey the account already has', async () => {
    const owner = await account();
    const current = await session(owner, owner.keys[0]);
    const { options } = await devices.addOptions(current);
    expect(options.excludeCredentials?.map(({ id }) => id).sort()).toEqual(
      owner.keys.map(({ passkey }) => passkey.credentialId).sort(),
    );
    expect(options.authenticatorSelection.userVerification).toBe('required');
    expect(options.rp.id).toBe(rpId);
    expect(options.extensions).toEqual({ prf: {} });
  });

  it('spends a challenge on its first attempt, and only in its own session', async () => {
    const owner = await account(1);
    const current = await session(owner, owner.keys[0]);
    const other = await session(owner, owner.keys[0]);
    const { challengeId, options } = await devices.addOptions(current);
    const passkey = softwarePasskey(rpId);
    const response = passkey.attest({ challenge: options.challenge, origin });
    expect(await devices.add(other, challengeId, response)).toBe(false);
    expect(await devices.add(current, challengeId, response)).toBe(true);
    expect(await devices.add(current, challengeId, response)).toBe(false);
    expect(await fixtures.pendingOf(owner)).toHaveLength(1);
  });

  it('refuses a passkey made without user verification, or for another origin', async () => {
    const owner = await account(1);
    const current = await session(owner, owner.keys[0]);
    for (const attestation of [
      { userVerified: false, origin },
      { origin: 'https://elsewhere.example.org' },
    ]) {
      const { challengeId, options } = await devices.addOptions(current);
      const response = softwarePasskey(rpId).attest({
        challenge: options.challenge,
        ...attestation,
      });
      expect(await devices.add(current, challengeId, response)).toBe(false);
    }
    expect(await fixtures.pendingOf(owner)).toEqual([]);
    expect(noticesTo(owner)).toEqual([]);
  });

  it('refuses a step-up from a pending passkey, and accepts it once the wait is over', async () => {
    const owner = await account(1);
    const current = await session(owner, owner.keys[0]);
    const passkey = await added(current);
    const { options } = await stepUp.options(current, { purpose: 'vault_unlock' });
    expect(options.allowCredentials?.map(({ id }) => id)).toEqual([
      owner.keys[0].passkey.credentialId,
    ]);
    expect(await stepsUp(current, passkey)).toBe(false);
    await fixtures.waitOver(owner);
    expect(await stepsUp(current, passkey)).toBe(true);
  });

  it('records the activation once the wait is over, with no actor', async () => {
    const owner = await account(1);
    const current = await session(owner, owner.keys[0]);
    await added(current);
    const [pending] = await fixtures.pendingOf(owner);
    await fixtures.waitOver(owner);
    expect((await devices.status(owner.accountId)).pendingUntil).toBeNull();
    const listed = await devices.list(current);
    expect(listed.passkeys.find(({ id }) => id === pending?.id)).toMatchObject({
      state: 'active',
      activeFrom: null,
    });
    expect(await events(owner, ['passkey_activated'])).toEqual([
      { code: 'passkey_activated', actor: null, details: { passkeyId: pending?.id } },
    ]);
    expect(await fixtures.pendingOf(owner)).toEqual([]);
  });

  it('records an activation once when two reads find it due at once', async () => {
    const owner = await account(1);
    const current = await session(owner, owner.keys[0]);
    await added(current);
    await fixtures.waitOver(owner);
    await Promise.all([
      devices.list(current),
      devices.status(owner.accountId),
      devices.list(current),
    ]);
    expect(await events(owner, ['passkey_activated'])).toHaveLength(1);
  });

  it('cancels a pending passkey with its own notice, and never counts it as the last active one', async () => {
    const owner = await account(1);
    const current = await session(owner, owner.keys[0]);
    await added(current);
    const [pending] = await fixtures.pendingOf(owner);
    expect(await devices.revokePasskey(current, owner.keys[0].id, noVault)).toBe('last_active');
    expect(await devices.revokePasskey(current, pending?.id ?? '', noVault)).toBe('revoked');
    expect(noticesTo(owner)).toEqual(['passkey_added', 'pending_passkey_cancelled']);
    expect(await events(owner, ['passkey_revoked'])).toEqual([
      {
        code: 'passkey_revoked',
        actor: owner.accountId,
        details: { passkeyId: pending?.id, pending: true },
      },
    ]);
    expect((await devices.status(owner.accountId)).pendingUntil).toBeNull();
    expect((await devices.list(current)).passkeys.map(({ id }) => id)).toEqual([owner.keys[0].id]);
  });
});
