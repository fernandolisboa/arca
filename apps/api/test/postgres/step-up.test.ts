import { randomBytes, randomUUID } from 'node:crypto';
import type { StepUpOptionsRequest } from '@arca/api-contract/routes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/audit/log.js';
import { credentialStore } from '../../src/auth/auth.js';
import type { SignedIn } from '../../src/auth/service.js';
import { createStepUp } from '../../src/auth/step-up.js';
import type { CanonicalAction } from '../../src/auth/step-up-encoding.js';
import { reverifyStepUp } from '../../src/auth/step-up-reverify.js';
import { softwarePasskey, type SoftwarePasskey } from '../software-passkey.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';
import {
  addPasskey as addPasskeyTo,
  ceremony as ceremonyWith,
  type Ceremony,
  origin,
  person as newPerson,
  type Person,
  rpId,
  toRequest,
} from './step-up-people.js';

// Step-up on the real migrations and the app_auth pool (spec 0003, R5). Synthetic data only.

let testDatabase: AuthTestDatabase;
let stepUp: ReturnType<typeof createStepUp>;

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  const { authDb, auditDb } = testDatabase;
  stepUp = createStepUp({
    db: authDb,
    credentials: credentialStore(authDb),
    audit: auditLog(auditDb),
    origin,
    logger: silentLogger,
  });
});

afterAll(async () => {
  await testDatabase.drop();
});

/** Another session of the same account. */
async function otherSession({ signedIn, passkey }: Person): Promise<SignedIn> {
  const sessionId = randomUUID();
  await testDatabase.asAdmin((client) =>
    client.query(
      `INSERT INTO auth.session (id, expires_at, token, user_id, device_browser, device_os, credential_id)
       VALUES ($1, now() + interval '1 day', $2, $3, 'chrome', 'android', $4)`,
      [sessionId, randomBytes(16).toString('hex'), signedIn.accountId, passkey.credentialId],
    ),
  );
  return { accountId: signedIn.accountId, sessionId };
}

const nonce = () => randomBytes(16);
const revokeSession = (target: string, actionNonce = nonce()): CanonicalAction => ({
  action: 'revokeSession',
  targets: [target],
  nonce: actionNonce,
});
const ceremony = (owner: Person, request: StepUpOptionsRequest, options?: Ceremony) =>
  ceremonyWith(stepUp, owner, request, options);
const person = () => newPerson(testDatabase);
const addPasskey = (accountId: string, passkey: SoftwarePasskey) =>
  addPasskeyTo(testDatabase, accountId, passkey);

const sensitive = (action: CanonicalAction) => toRequest('sensitive_settings', action);

async function stepUpRows(accountId: string) {
  return testDatabase.asAdmin(async (client) => {
    const result = await client.query<{
      id: string;
      credential_id: string;
      purpose: string;
      subject_hash: Buffer;
      nonce: Buffer;
      authenticator_data: Buffer;
      client_data_json: Buffer;
      signature: Buffer;
      consumed_at: Date | null;
    }>('SELECT * FROM auth.step_up WHERE account_id = $1', [accountId]);
    return result.rows;
  });
}

async function stepUpEvents(accountId: string) {
  return testDatabase.asAdmin(async (client) => {
    const result = await client.query<{ actor: string; details: unknown }>(
      `SELECT actor_account_id AS actor, details FROM audit.event
        WHERE subject_account_id = $1 AND code = 'step_up_verified'`,
      [accountId],
    );
    return result.rows;
  });
}

describe('a step-up (spec 0003, R5)', () => {
  it('approves exactly the action it was verified for, once', async () => {
    const owner = await person();
    const action = revokeSession(randomUUID());
    expect((await ceremony(owner, sensitive(action))).verified).toBe(true);
    expect(await stepUp.consume(owner.signedIn, 'sensitive_settings', action)).toBe(true);
    expect(await stepUp.consume(owner.signedIn, 'sensitive_settings', action)).toBe(false);
  });

  it('offers only the account’s own passkeys, with UV required and a 2-minute timeout', async () => {
    const owner = await person();
    const { options } = await stepUp.options(owner.signedIn, sensitive(revokeSession('a')));
    expect(options).toMatchObject({
      rpId,
      timeout: 120_000,
      userVerification: 'required',
      allowCredentials: [{ id: owner.passkey.credentialId, type: 'public-key' }],
    });
    expect(options).not.toHaveProperty('extensions');
  });

  it('records the event with its purpose, and stores an assertion that verifies again', async () => {
    const owner = await person();
    const action = revokeSession(randomUUID());
    await ceremony(owner, toRequest('data_export', action));
    const events = await stepUpEvents(owner.signedIn.accountId);
    expect(events).toEqual([
      { actor: owner.signedIn.accountId, details: { purpose: 'data_export' } },
    ]);
    const [row] = await stepUpRows(owner.signedIn.accountId);
    if (row === undefined) throw new Error('no step-up stored');
    const expected = {
      purpose: 'data_export' as const,
      subjectHash: new Uint8Array(row.subject_hash),
      credentialId: owner.passkey.credentialId,
      publicKey: new Uint8Array(Buffer.from(owner.passkey.publicKey, 'base64')),
      rpId,
      origin,
    };
    const stored = {
      credentialId: row.credential_id,
      nonce: new Uint8Array(row.nonce),
      authenticatorData: new Uint8Array(row.authenticator_data),
      clientDataJson: new Uint8Array(row.client_data_json),
      signature: new Uint8Array(row.signature),
    };
    expect(await reverifyStepUp(stored, expected)).toBe(true);
    expect(await reverifyStepUp(stored, { ...expected, purpose: 'sensitive_settings' })).toBe(
      false,
    );
  });

  it('records the signature counter, and refuses one that did not move forward', async () => {
    const owner = await person();
    await ceremony(owner, sensitive(revokeSession('a')));
    const [stored] = await testDatabase.asAdmin(async (client) => {
      const result = await client.query<{ counter: number }>(
        'SELECT counter FROM auth.passkey WHERE credential_id = $1',
        [owner.passkey.credentialId],
      );
      return result.rows;
    });
    expect(stored?.counter).toBe(1);
    await testDatabase.asAdmin((client) =>
      client.query('UPDATE auth.passkey SET counter = 50 WHERE credential_id = $1', [
        owner.passkey.credentialId,
      ]),
    );
    expect((await ceremony(owner, sensitive(revokeSession('b')))).verified).toBe(false);
  });

  it('lets two concurrent actions spend one step-up only once', async () => {
    const owner = await person();
    const action = revokeSession(randomUUID());
    await ceremony(owner, sensitive(action));
    const spent = await Promise.all([
      stepUp.consume(owner.signedIn, 'sensitive_settings', action),
      stepUp.consume(owner.signedIn, 'sensitive_settings', action),
    ]);
    expect(spent.filter(Boolean)).toHaveLength(1);
  });

  it('spends a step-up for a consumer that keeps its copy only if the copy commits', async () => {
    const owner = await person();
    const action = revokeSession(randomUUID());
    await ceremony(owner, sensitive(action));
    await expect(
      stepUp.spend(owner.signedIn, 'sensitive_settings', action, () =>
        Promise.reject(new Error('storage failed')),
      ),
    ).rejects.toThrow('storage failed');
    const copied: string[] = [];
    expect(
      await stepUp.spend(owner.signedIn, 'sensitive_settings', action, (_tx, spent) => {
        copied.push(spent.credentialId);
        return Promise.resolve();
      }),
    ).toBe(true);
    expect(copied).toEqual([owner.passkey.credentialId]);
    expect(await stepUp.consume(owner.signedIn, 'sensitive_settings', action)).toBe(false);
  });
});

describe('a step-up that must be refused (spec 0003, R5)', () => {
  it('refuses a step-up for one action presented to another of the same purpose', async () => {
    const owner = await person();
    const shared = nonce();
    await ceremony(owner, sensitive(revokeSession(randomUUID(), shared)));
    const regenerateKit: CanonicalAction = {
      action: 'regenerateRecoveryKit',
      targets: [],
      nonce: shared,
    };
    expect(await stepUp.consume(owner.signedIn, 'sensitive_settings', regenerateKit)).toBe(false);
  });

  it('refuses a replayed challenge', async () => {
    const owner = await person();
    const { challengeId, response } = await ceremony(owner, sensitive(revokeSession('a')));
    expect(await stepUp.verify(owner.signedIn, challengeId, response)).toBe(false);
  });

  it('spends a challenge on its first attempt, even a failed one', async () => {
    const owner = await person();
    const { challengeId, options } = await stepUp.options(
      owner.signedIn,
      sensitive(revokeSession('a')),
    );
    const unverified = owner.passkey.assert({
      challenge: options.challenge,
      origin,
      userVerified: false,
    });
    expect(await stepUp.verify(owner.signedIn, challengeId, unverified)).toBe(false);
    const good = owner.passkey.assert({ challenge: options.challenge, origin });
    expect(await stepUp.verify(owner.signedIn, challengeId, good)).toBe(false);
  });

  it('refuses an expired challenge', async () => {
    const owner = await person();
    const { challengeId, options } = await stepUp.options(
      owner.signedIn,
      sensitive(revokeSession('a')),
    );
    await testDatabase.asAdmin((client) =>
      client.query(
        "UPDATE auth.step_up_challenge SET expires_at = now() - interval '1 second' WHERE id = $1",
        [challengeId],
      ),
    );
    const response = owner.passkey.assert({ challenge: options.challenge, origin });
    expect(await stepUp.verify(owner.signedIn, challengeId, response)).toBe(false);
  });

  it('refuses a step-up spent after 5 minutes', async () => {
    const owner = await person();
    const action = revokeSession(randomUUID());
    await ceremony(owner, sensitive(action));
    await testDatabase.asAdmin((client) =>
      client.query(
        "UPDATE auth.step_up SET verified_at = now() - interval '5 minutes 1 second' WHERE account_id = $1",
        [owner.signedIn.accountId],
      ),
    );
    expect(await stepUp.consume(owner.signedIn, 'sensitive_settings', action)).toBe(false);
  });

  it('refuses a step-up of another purpose', async () => {
    const owner = await person();
    const action = revokeSession(randomUUID());
    await ceremony(owner, toRequest('data_export', action));
    expect(await stepUp.consume(owner.signedIn, 'sensitive_settings', action)).toBe(false);
  });

  it.each<[string, (action: CanonicalAction) => CanonicalAction]>([
    ['another target', (a) => ({ ...a, targets: [randomUUID()] })],
    ['another nonce', (a) => ({ ...a, nonce: nonce() })],
    ['other security fields', (a) => ({ ...a, fields: { amount: '1' } })],
  ])('refuses a step-up for another subject: %s', async (_, change) => {
    const owner = await person();
    const action = revokeSession(randomUUID());
    await ceremony(owner, sensitive(action));
    expect(await stepUp.consume(owner.signedIn, 'sensitive_settings', change(action))).toBe(false);
  });

  it('refuses a challenge verified from another session', async () => {
    const owner = await person();
    const elsewhere = await otherSession(owner);
    const { verified } = await ceremony(owner, sensitive(revokeSession('a')), {
      verifiedBy: elsewhere,
    });
    expect(verified).toBe(false);
  });

  it('refuses a step-up spent by another session of the same account', async () => {
    const owner = await person();
    const elsewhere = await otherSession(owner);
    const action = revokeSession(randomUUID());
    await ceremony(owner, sensitive(action));
    expect(await stepUp.consume(elsewhere, 'sensitive_settings', action)).toBe(false);
    expect(await stepUp.consume(owner.signedIn, 'sensitive_settings', action)).toBe(true);
  });

  it('refuses a challenge signed by a passkey of another account', async () => {
    const owner = await person();
    const stranger = await person();
    const { verified } = await ceremony(owner, sensitive(revokeSession('a')), {
      signer: stranger.passkey,
    });
    expect(verified).toBe(false);
  });

  it('refuses a challenge signed by a revoked passkey', async () => {
    const owner = await person();
    const revoked = softwarePasskey(rpId);
    await addPasskey(owner.signedIn.accountId, revoked);
    await testDatabase.asAdmin((client) =>
      client.query('DELETE FROM auth.passkey WHERE credential_id = $1', [revoked.credentialId]),
    );
    const { verified } = await ceremony(owner, sensitive(revokeSession('a')), { signer: revoked });
    expect(verified).toBe(false);
  });

  it('refuses an assertion without user verification', async () => {
    const owner = await person();
    const { verified } = await ceremony(owner, sensitive(revokeSession('a')), {
      userVerified: false,
    });
    expect(verified).toBe(false);
  });

  it('refuses an assertion signed for another origin', async () => {
    const owner = await person();
    const { challengeId, options } = await stepUp.options(
      owner.signedIn,
      sensitive(revokeSession('a')),
    );
    const response = owner.passkey.assert({
      challenge: options.challenge,
      origin: 'http://localhost:4174',
    });
    expect(await stepUp.verify(owner.signedIn, challengeId, response)).toBe(false);
  });

  it('stores nothing and writes no event for a refused step-up', async () => {
    const owner = await person();
    await ceremony(owner, sensitive(revokeSession('a')), { userVerified: false });
    expect(await stepUpRows(owner.signedIn.accountId)).toEqual([]);
    expect(await stepUpEvents(owner.signedIn.accountId)).toEqual([]);
  });

  it('stores no step-up when its event cannot be recorded', async () => {
    const owner = await person();
    const unrecorded = createStepUp({
      db: testDatabase.authDb,
      credentials: credentialStore(testDatabase.authDb),
      audit: { record: () => Promise.reject(new Error('audit unavailable')) },
      origin,
      logger: silentLogger,
    });
    const action = revokeSession(randomUUID());
    const { challengeId, options } = await unrecorded.options(owner.signedIn, sensitive(action));
    const response = owner.passkey.assert({ challenge: options.challenge, origin });
    await expect(unrecorded.verify(owner.signedIn, challengeId, response)).rejects.toThrow(
      'audit unavailable',
    );
    expect(await stepUpRows(owner.signedIn.accountId)).toEqual([]);
    expect(await stepUp.consume(owner.signedIn, 'sensitive_settings', action)).toBe(false);
  });
});

describe('vault_unlock (spec 0003, R5)', () => {
  it('opens a 15-minute window for its own session that spending never closes', async () => {
    const owner = await person();
    const elsewhere = await otherSession(owner);
    expect(await stepUp.vaultUnlocked(owner.signedIn)).toBe(false);
    expect((await ceremony(owner, { purpose: 'vault_unlock' })).verified).toBe(true);
    expect(await stepUp.vaultUnlocked(owner.signedIn)).toBe(true);
    expect(await stepUp.vaultUnlocked(owner.signedIn)).toBe(true);
    expect(await stepUp.vaultUnlocked(elsewhere)).toBe(false);
    await testDatabase.asAdmin((client) =>
      client.query(
        "UPDATE auth.step_up SET verified_at = now() - interval '15 minutes 1 second' WHERE account_id = $1",
        [owner.signedIn.accountId],
      ),
    );
    expect(await stepUp.vaultUnlocked(owner.signedIn)).toBe(false);
  });

  it('cannot be spent on an action', async () => {
    const owner = await person();
    await ceremony(owner, { purpose: 'vault_unlock' });
    const [row] = await stepUpRows(owner.signedIn.accountId);
    expect(row?.subject_hash).toHaveLength(0);
    const writeAction: CanonicalAction = {
      action: 'replaceDocuments',
      targets: [],
      nonce: nonce(),
    };
    expect(await stepUp.consume(owner.signedIn, 'vault_write', writeAction)).toBe(false);
  });
});

describe('the step-up tables', () => {
  it.each([
    ['a subject for vault_unlock', 'vault_unlock', 32],
    ['no subject for another purpose', 'sensitive_settings', 0],
  ])('refuse %s', async (_, purpose, subjectLength) => {
    const owner = await person();
    await expect(
      testDatabase.asAdmin((client) =>
        client.query(
          `INSERT INTO auth.step_up_challenge (account_id, session_id, purpose, subject_hash, nonce)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            owner.signedIn.accountId,
            owner.signedIn.sessionId,
            purpose,
            Buffer.alloc(subjectLength),
            Buffer.alloc(32),
          ],
        ),
      ),
    ).rejects.toThrow('step_up_challenge_subject');
  });
});

describe('the step-up sweep', () => {
  it('drops expired challenges and step-ups no action can spend any more', async () => {
    const owner = await person();
    const kept = revokeSession(randomUUID());
    await ceremony(owner, sensitive(kept));
    await stepUp.consume(owner.signedIn, 'sensitive_settings', kept);
    await ceremony(owner, sensitive(revokeSession('unused')));
    await stepUp.options(owner.signedIn, sensitive(revokeSession('abandoned')));
    await testDatabase.asAdmin(async (client) => {
      await client.query(
        "UPDATE auth.step_up SET verified_at = now() - interval '16 minutes' WHERE account_id = $1",
        [owner.signedIn.accountId],
      );
      await client.query(
        "UPDATE auth.step_up_challenge SET expires_at = now() - interval '1 second' WHERE account_id = $1",
        [owner.signedIn.accountId],
      );
    });
    await stepUp.options(owner.signedIn, sensitive(revokeSession('next')));
    const rows = await stepUpRows(owner.signedIn.accountId);
    expect(rows.map((row) => row.consumed_at !== null)).toEqual([true]);
    const challenges = await testDatabase.asAdmin(async (client) => {
      const result = await client.query(
        'SELECT FROM auth.step_up_challenge WHERE account_id = $1',
        [owner.signedIn.accountId],
      );
      return result.rowCount;
    });
    expect(challenges).toBe(1);
  });
});
