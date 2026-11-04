import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/audit/log.js';
import { credentialStore } from '../../src/auth/auth.js';
import { createDevices, type Devices } from '../../src/auth/devices.js';
import { createVault, type Vault } from '../../src/vault/vault.js';
import { accountFixtures, type Account } from './accounts.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';

// The vault's server side on the real migrations: app_api under the account's identity, the
// active passkeys read on app_auth (spec 0005, R2). Synthetic data only.
const origin = 'http://localhost:3000';
const rpId = 'localhost';

let testDatabase: AuthTestDatabase;
let fixtures: ReturnType<typeof accountFixtures>;
let vault: Vault;
let devices: Devices;
let forgetFails = false;

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  fixtures = accountFixtures(testDatabase, rpId);
  const { authDb, apiDb, auditDb } = testDatabase;
  const audit = auditLog(auditDb);
  const credentials = credentialStore(authDb);
  vault = createVault({
    db: apiDb,
    activeCredentials: async (accountId) =>
      (await credentials.activeOf(accountId)).map(({ credentialId }) => credentialId),
    audit,
  });
  devices = createDevices({
    db: authDb,
    audit,
    notices: { send: () => Promise.resolve() },
    logger: silentLogger,
    origin,
  });
});

afterAll(async () => {
  await testDatabase.drop();
});

const recipientText = () =>
  `age1pq1${randomBytes(40)
    .toString('hex')
    .replace(/[1bio]/g, 'q')}`;
const sealed = () => randomBytes(200).toString('base64url');
const credentialOf = (owner: Account, index = 0) =>
  owner.keys[index]?.passkey.credentialId ?? 'missing';

const envelopeRows = (owner: Account) =>
  testDatabase.asAdmin(
    async (client) =>
      (
        await client.query<{ kind: string; credential_id: string | null }>(
          `SELECT kind, credential_id FROM vault.envelope WHERE account_id = $1
            ORDER BY kind, credential_id`,
          [owner.accountId],
        )
      ).rows,
  );

async function setUp(owner: Account, passkeys = [credentialOf(owner)]) {
  const recipient = recipientText();
  const outcome = await vault.setUp(owner.accountId, {
    recipient,
    passkeyEnvelopes: passkeys.map((credentialId) => ({ credentialId, ciphertext: sealed() })),
    recoveryEnvelope: sealed(),
  });
  return { recipient, outcome };
}

describe('vault set-up and status (spec 0005, R2)', () => {
  it('stores the recipient with its recovery and passkey envelopes, once', async () => {
    const owner = await fixtures.account(2);
    expect(await vault.status(owner.accountId)).toEqual({ recipient: null });
    const { recipient, outcome } = await setUp(owner, [
      credentialOf(owner, 0),
      credentialOf(owner, 1),
    ]);
    expect(outcome).toBe('created');
    expect(await vault.status(owner.accountId)).toEqual({ recipient });
    expect(await envelopeRows(owner)).toEqual(
      [
        { kind: 'passkey_prf', credential_id: credentialOf(owner, 0) },
        { kind: 'passkey_prf', credential_id: credentialOf(owner, 1) },
        { kind: 'recovery', credential_id: null },
      ].sort((a, b) =>
        `${a.kind}${a.credential_id ?? ''}`.localeCompare(`${b.kind}${b.credential_id ?? ''}`),
      ),
    );
    expect((await setUp(owner)).outcome).toBe('exists');
    expect(await vault.status(owner.accountId)).toEqual({ recipient });
  });

  it('lets only one of two concurrent set-ups through', async () => {
    const owner = await fixtures.account(1);
    const outcomes = await Promise.all([setUp(owner), setUp(owner)]);
    expect(outcomes.map(({ outcome }) => outcome).sort()).toEqual(['created', 'exists']);
    expect((await envelopeRows(owner)).length).toBe(2);
  });

  it("refuses an envelope for another account's passkey and stores nothing", async () => {
    const owner = await fixtures.account(1);
    const stranger = await fixtures.account(1);
    expect((await setUp(owner, [credentialOf(stranger)])).outcome).toBe('unknown_passkey');
    expect(await vault.status(owner.accountId)).toEqual({ recipient: null });
  });

  it('sets up a vault with the recovery envelope alone, for passkeys without PRF', async () => {
    const owner = await fixtures.account(1);
    expect((await setUp(owner, [])).outcome).toBe('created');
    expect(await envelopeRows(owner)).toEqual([{ kind: 'recovery', credential_id: null }]);
  });
});

describe('vault envelopes (spec 0005, R2)', () => {
  it('serves nothing before set-up', async () => {
    const owner = await fixtures.account(1);
    expect(await vault.envelopes(owner.accountId)).toBeNull();
    expect(await fixtures.events(owner, ['vault_envelopes_fetched'])).toEqual([]);
  });

  it("serves the account's envelopes, records the fetch, and never another account's", async () => {
    const owner = await fixtures.account(1);
    const stranger = await fixtures.account(1);
    const { recipient } = await setUp(owner);
    await setUp(stranger);
    const found = await vault.envelopes(owner.accountId);
    expect(found?.recipients).toEqual([
      { id: expect.any(String) as string, recipient, current: true },
    ]);
    expect(found?.envelopes.map(({ kind, credentialId }) => ({ kind, credentialId }))).toEqual(
      expect.arrayContaining([
        { kind: 'recovery', credentialId: null },
        { kind: 'passkey_prf', credentialId: credentialOf(owner) },
      ]),
    );
    expect(found?.envelopes).toHaveLength(2);
    expect(
      found?.envelopes.every(({ recipientId }) => recipientId === found.recipients[0]?.id),
    ).toBe(true);
    expect(await fixtures.events(owner, ['vault_envelopes_fetched'])).toEqual([
      { code: 'vault_envelopes_fetched', actor: owner.accountId, details: {} },
    ]);
  });

  it('never serves the envelope of a passkey that is no longer active', async () => {
    const owner = await fixtures.account(2);
    await setUp(owner, [credentialOf(owner, 0), credentialOf(owner, 1)]);
    // An orphan, as a revocation that failed after its envelope step would leave nothing; made
    // here by deleting the passkey behind the vault's back.
    await testDatabase.asAdmin((client) =>
      client.query('DELETE FROM auth.passkey WHERE credential_id = $1', [credentialOf(owner, 1)]),
    );
    const found = await vault.envelopes(owner.accountId);
    expect(found?.envelopes.map(({ credentialId }) => credentialId).sort()).toEqual(
      [credentialOf(owner, 0), null].sort(),
    );
  });

  it("adds a passkey's envelope for the current recipient and keeps one already there", async () => {
    const owner = await fixtures.account(2);
    expect(
      await vault.addEnvelope(owner.accountId, {
        credentialId: credentialOf(owner, 1),
        ciphertext: sealed(),
      }),
    ).toBe('no_vault');
    await setUp(owner);
    const first = sealed();
    expect(
      await vault.addEnvelope(owner.accountId, {
        credentialId: credentialOf(owner, 1),
        ciphertext: first,
      }),
    ).toBe('added');
    expect(
      await vault.addEnvelope(owner.accountId, {
        credentialId: credentialOf(owner, 1),
        ciphertext: sealed(),
      }),
    ).toBe('added');
    const found = await vault.envelopes(owner.accountId);
    expect(
      found?.envelopes.filter(({ credentialId }) => credentialId === credentialOf(owner, 1)),
    ).toEqual([expect.objectContaining({ ciphertext: first })]);
  });

  it("refuses to add an envelope for another account's passkey", async () => {
    const owner = await fixtures.account(1);
    const stranger = await fixtures.account(1);
    await setUp(owner);
    expect(
      await vault.addEnvelope(owner.accountId, {
        credentialId: credentialOf(stranger),
        ciphertext: sealed(),
      }),
    ).toBe('unknown_passkey');
  });
});

describe('passkey revocation and the vault (spec 0005, R2)', () => {
  const revoke = (owner: Account, index: number) =>
    devices.revokePasskey(
      { accountId: owner.accountId, sessionId: '00000000-0000-4000-8000-000000000000' },
      owner.keys[index]?.id ?? '',
      (credentialId) =>
        forgetFails
          ? Promise.reject(new Error('the vault is down'))
          : vault.forgetPasskey(owner.accountId, credentialId),
    );

  it("deletes the passkey's envelope before revoking it", async () => {
    const owner = await fixtures.account(2);
    await setUp(owner, [credentialOf(owner, 0), credentialOf(owner, 1)]);
    expect(await revoke(owner, 1)).toBe('revoked');
    expect(await envelopeRows(owner)).toEqual([
      { kind: 'passkey_prf', credential_id: credentialOf(owner, 0) },
      { kind: 'recovery', credential_id: null },
    ]);
  });

  it('keeps the envelope when the revocation is refused', async () => {
    const owner = await fixtures.account(1);
    await setUp(owner);
    expect(await revoke(owner, 0)).toBe('last_active');
    expect((await envelopeRows(owner)).length).toBe(2);
  });

  it('keeps the passkey when its envelope could not be deleted', async () => {
    const owner = await fixtures.account(2);
    await setUp(owner, [credentialOf(owner, 0), credentialOf(owner, 1)]);
    forgetFails = true;
    try {
      await expect(revoke(owner, 1)).rejects.toThrow('the vault is down');
    } finally {
      forgetFails = false;
    }
    expect(
      await fixtures.count('SELECT count(*)::int AS n FROM auth.passkey WHERE user_id = $1', [
        owner.accountId,
      ]),
    ).toBe(2);
    expect((await envelopeRows(owner)).length).toBe(3);
  });
});
