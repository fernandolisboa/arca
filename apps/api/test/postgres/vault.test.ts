import type { AuditEventCode } from '@arca/api-contract/routes';
import { randomBytes, randomUUID } from 'node:crypto';
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
    expect(await vault.status(owner.accountId)).toEqual({ recipient: null, resealDue: false });
    const { recipient, outcome } = await setUp(owner, [
      credentialOf(owner, 0),
      credentialOf(owner, 1),
    ]);
    expect(outcome).toBe('created');
    expect(await vault.status(owner.accountId)).toEqual({ recipient, resealDue: false });
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
    expect(await vault.status(owner.accountId)).toEqual({ recipient, resealDue: false });
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
    expect(await vault.status(owner.accountId)).toEqual({ recipient: null, resealDue: false });
  });

  it('sets up a vault with the recovery envelope alone, for passkeys without PRF', async () => {
    const owner = await fixtures.account(1);
    expect((await setUp(owner, [])).outcome).toBe('created');
    expect(await envelopeRows(owner)).toEqual([{ kind: 'recovery', credential_id: null }]);
  });
});

describe('a new vault recovery secret due (spec 0003, R6)', () => {
  const record = (owner: Account, code: AuditEventCode) =>
    auditLog(testDatabase.auditDb).record({
      code,
      subjectAccountId: owner.accountId,
      actorAccountId: owner.accountId,
      details: {},
    });

  it.each<[string, AuditEventCode[], boolean]>([
    ['right after set-up', [], false],
    ['after a new recovery kit', ['recovery_kit_regenerated'], true],
    ['after an account recovery', ['recovery_completed'], true],
    ['after a recovery that was cancelled', ['recovery_completed', 'recovery_cancelled'], false],
    [
      'after a new kit, even if a later recovery was cancelled',
      ['recovery_kit_regenerated', 'recovery_completed', 'recovery_cancelled'],
      true,
    ],
    [
      'after a recovery that followed a cancelled one',
      ['recovery_completed', 'recovery_cancelled', 'recovery_completed'],
      true,
    ],
    ['once re-sealed', ['recovery_kit_regenerated', 'vault_recovery_resealed'], false],
    [
      'after a kit newer than the re-seal',
      ['vault_recovery_resealed', 'recovery_kit_regenerated'],
      true,
    ],
    [
      'after events that do not touch the secret',
      ['recovery_completed', 'vault_envelopes_fetched'],
      true,
    ],
  ])('%s', async (_, codes, due) => {
    const owner = await fixtures.account(1);
    const { recipient } = await setUp(owner);
    for (const code of codes) await record(owner, code);
    expect(await vault.status(owner.accountId)).toEqual({ recipient, resealDue: due });
  });

  it("is never due before set-up, nor from another account's events", async () => {
    const owner = await fixtures.account(1);
    const stranger = await fixtures.account(1);
    await record(owner, 'recovery_kit_regenerated');
    expect(await vault.status(owner.accountId)).toEqual({ recipient: null, resealDue: false });
    const { recipient } = await setUp(stranger);
    await record(owner, 'recovery_completed');
    expect(await vault.status(stranger.accountId)).toEqual({ recipient, resealDue: false });
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

const recipientsOf = (owner: Account) =>
  testDatabase.asAdmin(
    async (client) =>
      (
        await client.query<{ id: string; recipient: string; rotated: boolean }>(
          `SELECT id, recipient, rotated_at IS NOT NULL AS rotated FROM vault.recipient
            WHERE account_id = $1 ORDER BY created_at, rotated_at NULLS LAST`,
          [owner.accountId],
        )
      ).rows,
  );

const currentId = async (owner: Account) =>
  (await recipientsOf(owner)).find(({ rotated }) => !rotated)?.id ?? randomUUID();

const identity = (owner: Account, from: string, passkeys = [credentialOf(owner)]) => ({
  from,
  recipient: recipientText(),
  passkeyEnvelopes: passkeys.map((credentialId) => ({ credentialId, ciphertext: sealed() })),
  recoveryEnvelope: sealed(),
});

describe('vault rotation, re-sealing and reset (spec 0005, R2)', () => {
  it('records the set-up', async () => {
    const owner = await fixtures.account(1);
    await setUp(owner);
    expect(await fixtures.events(owner, ['vault_created'])).toEqual([
      { code: 'vault_created', actor: owner.accountId, details: {} },
    ]);
  });

  it('rotates: the new recipient is current and the old one keeps its envelopes', async () => {
    const owner = await fixtures.account(1);
    const { recipient: old } = await setUp(owner);
    const next = identity(owner, await currentId(owner));
    expect(await vault.rotate(owner.accountId, next)).toBe('rotated');
    expect(
      (await recipientsOf(owner)).map(({ recipient, rotated }) => ({ recipient, rotated })),
    ).toEqual([
      { recipient: old, rotated: true },
      { recipient: next.recipient, rotated: false },
    ]);
    expect(await vault.status(owner.accountId)).toEqual({
      recipient: next.recipient,
      resealDue: false,
    });
    expect((await envelopeRows(owner)).length).toBe(4);
    const found = await vault.envelopes(owner.accountId);
    expect(found?.recipients.map(({ current }) => current)).toEqual([false, true]);
    expect(await fixtures.events(owner, ['vault_identity_rotated'])).toHaveLength(1);
  });

  it('lets only one of two rotations from the same recipient through', async () => {
    const owner = await fixtures.account(1);
    await setUp(owner);
    const from = await currentId(owner);
    const outcomes = await Promise.all([
      vault.rotate(owner.accountId, identity(owner, from)),
      vault.rotate(owner.accountId, identity(owner, from)),
    ]);
    expect([...outcomes].sort()).toEqual(['changed', 'rotated']);
    expect((await recipientsOf(owner)).filter(({ rotated }) => !rotated)).toHaveLength(1);
  });

  it('rotates nothing before set-up or with a stranger passkey', async () => {
    const owner = await fixtures.account(1);
    const stranger = await fixtures.account(1);
    expect(await vault.rotate(owner.accountId, identity(owner, await currentId(owner)))).toBe(
      'no_vault',
    );
    await setUp(owner);
    expect(
      await vault.rotate(
        owner.accountId,
        identity(owner, await currentId(owner), [credentialOf(stranger)]),
      ),
    ).toBe('unknown_passkey');
    expect(await recipientsOf(owner)).toHaveLength(1);
  });

  it('refuses a rotation from a recipient another rotation already replaced', async () => {
    const owner = await fixtures.account(1);
    await setUp(owner);
    const stale = await currentId(owner);
    const newer = identity(owner, stale);
    expect(await vault.rotate(owner.accountId, newer)).toBe('rotated');
    expect(await vault.rotate(owner.accountId, identity(owner, stale))).toBe('changed');
    expect(await vault.status(owner.accountId)).toEqual({
      recipient: newer.recipient,
      resealDue: false,
    });
  });

  it('answers changed when another change left no current recipient to rotate', async () => {
    const owner = await fixtures.account(1);
    await setUp(owner);
    await testDatabase.asAdmin((client) =>
      client.query('UPDATE vault.recipient SET rotated_at = now() WHERE account_id = $1', [
        owner.accountId,
      ]),
    );
    expect(await vault.rotate(owner.accountId, identity(owner, await currentId(owner)))).toBe(
      'changed',
    );
    expect(await recipientsOf(owner)).toHaveLength(1);
  });

  it('re-seals every recovery envelope, a rotated identity included, or none', async () => {
    const owner = await fixtures.account(1);
    await setUp(owner);
    await vault.rotate(owner.accountId, identity(owner, await currentId(owner)));
    const [older, newer] = await recipientsOf(owner);
    const recoveryOf = async () =>
      ((await vault.envelopes(owner.accountId))?.envelopes ?? [])
        .filter(({ kind }) => kind === 'recovery')
        .map(({ recipientId, ciphertext }) => ({ recipientId, ciphertext }));
    const before = await recoveryOf();
    expect(
      await vault.resealRecovery(owner.accountId, {
        envelopes: [{ recipientId: newer?.id ?? '', ciphertext: sealed() }],
      }),
    ).toBe('changed');
    expect(await recoveryOf()).toEqual(before);
    const resealed = [older, newer].map((row) => ({
      recipientId: row?.id ?? '',
      ciphertext: sealed(),
    }));
    expect(await vault.resealRecovery(owner.accountId, { envelopes: resealed })).toBe('resealed');
    expect(
      [...(await recoveryOf())].sort((a, b) => a.recipientId.localeCompare(b.recipientId)),
    ).toEqual([...resealed].sort((a, b) => a.recipientId.localeCompare(b.recipientId)));
    expect(await fixtures.events(owner, ['vault_recovery_resealed'])).toHaveLength(1);
  });

  it('re-seals nothing before set-up', async () => {
    const owner = await fixtures.account(1);
    expect(
      await vault.resealRecovery(owner.accountId, {
        envelopes: [{ recipientId: '0b4f6a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b', ciphertext: sealed() }],
      }),
    ).toBe('no_vault');
  });

  it("resets the account's vault and nothing of another's, so it can be set up again", async () => {
    const owner = await fixtures.account(1);
    const stranger = await fixtures.account(1);
    expect(await vault.reset(owner.accountId)).toBe(false);
    await setUp(owner);
    await vault.rotate(owner.accountId, identity(owner, await currentId(owner)));
    await setUp(stranger);
    await testDatabase.asAdmin((client) =>
      client.query(
        `INSERT INTO vault.sharing_state (account_id, version, state, tag) VALUES ($1, 1, $2, $3)`,
        [owner.accountId, Buffer.from('{}'), randomBytes(32)],
      ),
    );
    expect(await vault.reset(owner.accountId)).toBe(true);
    expect(await recipientsOf(owner)).toEqual([]);
    expect(await envelopeRows(owner)).toEqual([]);
    expect(
      await fixtures.count(
        'SELECT count(*)::int AS n FROM vault.sharing_state WHERE account_id = $1',
        [owner.accountId],
      ),
    ).toBe(0);
    expect(await recipientsOf(stranger)).toHaveLength(1);
    expect(await fixtures.events(owner, ['vault_reset'])).toHaveLength(1);
    expect((await setUp(owner)).outcome).toBe('created');
  });
});
