import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Devices } from '../src/auth/devices.js';
import type { SignedIn } from '../src/auth/service.js';
import type { StepUpService } from '../src/auth/step-up.js';
import type { CanonicalAction } from '../src/auth/step-up-encoding.js';
import type {
  EnvelopeAdded,
  RecoveryResealed,
  SharingStateStored,
  Vault,
  VaultReset,
  VaultRotation,
  VaultSetUp,
} from '../src/vault/vault.js';
import type { Logger } from '@arca/telemetry';
import { noLimits } from './limits.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const owner: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const session = {
  accountId: owner.accountId,
  email: 'owner@example.com',
  confirmed: true,
  device: { browser: 'firefox' as const, os: 'linux' as const },
};
const recipient = `age1pq1${'q'.repeat(80)}`;
const sealed = randomBytes(120).toString('base64url');
const credentialId = 'synthetic-credential-one';
const envelopes = {
  recipients: [{ id: '0b4f6a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b', recipient, current: true }],
  envelopes: [
    {
      recipientId: '0b4f6a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b',
      kind: 'recovery' as const,
      credentialId: null,
      ciphertext: sealed,
    },
  ],
};

const taggedState = {
  version: 3,
  state: Buffer.from('{"documents":{},"format":1,"pins":{}}').toString('base64url'),
  tag: randomBytes(32).toString('base64url'),
};
const links = [
  { accountId: '5c4b3a29-1807-4f6e-9d5c-4b3a29180716', email: 'relative@example.com', recipient },
];

function setup({
  unlocked = true,
  setUp = 'created',
  added = 'added',
  stored = true,
  approved = true,
  rotated = 'rotated',
  resealed = 'resealed',
  reset,
  storedState = 'stored',
}: {
  unlocked?: boolean;
  setUp?: VaultSetUp;
  added?: EnvelopeAdded;
  stored?: boolean;
  approved?: boolean;
  rotated?: VaultRotation;
  resealed?: RecoveryResealed;
  reset?: VaultReset;
  storedState?: SharingStateStored;
} = {}) {
  const calls: unknown[] = [];
  const spent: { purpose: string; action: CanonicalAction }[] = [];
  const stepUp: StepUpService = {
    options: () => Promise.reject(new Error('unused')),
    verify: () => Promise.reject(new Error('unused')),
    consume: (_, purpose, action) => {
      spent.push({ purpose, action });
      return Promise.resolve(approved);
    },
    vaultUnlocked: () => Promise.resolve(unlocked),
  };
  const vault: Vault = {
    status: () => Promise.resolve({ recipient: stored ? recipient : null, resealDue: stored }),
    setUp: (accountId, request) => {
      calls.push(['setUp', accountId, request]);
      return Promise.resolve(setUp);
    },
    envelopes: (accountId) => {
      calls.push(['envelopes', accountId]);
      return Promise.resolve(stored ? envelopes : null);
    },
    addEnvelope: (accountId, envelope) => {
      calls.push(['addEnvelope', accountId, envelope]);
      return Promise.resolve(added);
    },
    forgetPasskey: (accountId, credential) => {
      calls.push(['forgetPasskey', accountId, credential]);
      return Promise.resolve();
    },
    rotate: (accountId, request) => {
      calls.push(['rotate', accountId, request]);
      return Promise.resolve(rotated);
    },
    resealRecovery: (accountId, request) => {
      calls.push(['resealRecovery', accountId, request]);
      return Promise.resolve(resealed);
    },
    reset: (accountId) => {
      calls.push(['reset', accountId]);
      return Promise.resolve(reset ?? (stored ? 'reset' : 'no_vault'));
    },
    sharingState: (accountId) => {
      calls.push(['sharingState', accountId]);
      return Promise.resolve(stored ? taggedState : null);
    },
    storeSharingState: (accountId, request) => {
      calls.push(['storeSharingState', accountId, request]);
      return Promise.resolve(storedState);
    },
    links: (accountId) => {
      calls.push(['links', accountId]);
      return Promise.resolve(links);
    },
  };
  const devices = {
    revokePasskey: async (
      _: SignedIn,
      passkeyId: string,
      beforeRevoke?: (credential: string) => Promise<void>,
    ) => {
      await beforeRevoke?.(credentialId);
      calls.push(['revokePasskey', passkeyId]);
      return 'revoked';
    },
    status: () =>
      Promise.resolve({
        pendingUntil: null,
        recoveryPending: false,
        deletionDueAt: null,
        sessionEnded: false,
      }),
  } as unknown as Devices;
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(owner),
      refresh: () => Promise.resolve({ session, setCookies: [] }),
    },
    authLimits: noLimits,
    stepUp,
    devices,
    vault,
  });
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
    app.request(`/v1${path}`, {
      method,
      headers: {
        origin,
        cookie: 'session=1',
        'content-type': 'application/json',
        'arca-step-up-nonce': 'MzMzMzMzMzMzMzMzMzMzMw',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { call, calls, spent };
}

const setUpBody = {
  recipient,
  passkeyEnvelopes: [{ credentialId, ciphertext: sealed }],
  recoveryEnvelope: sealed,
};

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('vault routes (spec 0005, R2)', () => {
  it('answers the status without a vault_unlock window', async () => {
    const { call } = setup({ unlocked: false });
    const response = await call('GET', '/vault');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recipient, resealDue: true });
  });

  it.each([
    ['POST', '/vault', setUpBody],
    ['GET', '/vault/envelopes', undefined],
    ['POST', '/vault/envelopes', { credentialId, ciphertext: sealed }],
  ] as const)('answers 403 to %s %s outside a vault_unlock window', async (method, path, body) => {
    const { call, calls } = setup({ unlocked: false });
    const response = await call(method, path, body);
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('step_up_required');
    expect(calls).toEqual([]);
  });

  it('sets up the vault for the signed-in account', async () => {
    const { call, calls } = setup();
    expect((await call('POST', '/vault', setUpBody)).status).toBe(200);
    expect(calls).toEqual([['setUp', owner.accountId, setUpBody]]);
  });

  it.each([
    ['exists', 409, 'vault_exists'],
    ['unknown_passkey', 400, 'invalid_request'],
  ] as const)('answers a %s set-up with %i', async (outcome, status, code) => {
    const { call } = setup({ setUp: outcome });
    const response = await call('POST', '/vault', setUpBody);
    expect(response.status).toBe(status);
    expect(await errorOf(response)).toBe(code);
  });

  it.each([
    ['a classic recipient', { ...setUpBody, recipient: `age1${'q'.repeat(58)}` }],
    ['a short envelope', { ...setUpBody, recoveryEnvelope: sealed.slice(0, 40) }],
    [
      'one passkey twice',
      {
        ...setUpBody,
        passkeyEnvelopes: [setUpBody.passkeyEnvelopes[0], setUpBody.passkeyEnvelopes[0]],
      },
    ],
    ['an extra field', { ...setUpBody, identity: 'AGE-SECRET-KEY-PQ-1' }],
  ])('refuses a set-up with %s', async (_, body) => {
    const { call, calls } = setup();
    expect((await call('POST', '/vault', body)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('serves the envelopes within the window, and 404 before set-up', async () => {
    const response = await setup().call('GET', '/vault/envelopes');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(envelopes);
    expect((await setup({ stored: false }).call('GET', '/vault/envelopes')).status).toBe(404);
  });

  it.each([
    ['added', 200],
    ['no_vault', 404],
    ['unknown_passkey', 400],
  ] as const)('answers an %s passkey envelope with %i', async (outcome, status) => {
    const { call, calls } = setup({ added: outcome });
    const body = { credentialId, ciphertext: sealed };
    expect((await call('POST', '/vault/envelopes', body)).status).toBe(status);
    expect(calls).toEqual([['addEnvelope', owner.accountId, body]]);
  });

  it("deletes a revoked passkey's envelope before the passkey", async () => {
    const { call, calls } = setup();
    const passkeyId = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
    expect((await call('POST', '/devices/passkeys/revoke', { passkeyId })).status).toBe(200);
    expect(calls).toEqual([
      ['forgetPasskey', owner.accountId, credentialId],
      ['revokePasskey', passkeyId],
    ]);
  });
});

const nonce = new Uint8Array(Buffer.from('MzMzMzMzMzMzMzMzMzMzMw', 'base64url'));
const recipientIds = [
  '0b4f6a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b',
  '7e6d5c4b-3a29-4817-8f6e-5d4c3b2a1908',
];
const rotateBody = { ...setUpBody, from: recipientIds[0] };
const resealBody = {
  envelopes: recipientIds.map((recipientId) => ({ recipientId, ciphertext: sealed })),
};

describe('vault rotation, re-sealing and reset (spec 0005, R2)', () => {
  it.each([
    ['POST', '/vault/rotate', rotateBody],
    ['PUT', '/vault/recovery-envelopes', resealBody],
    ['DELETE', '/vault', {}],
  ] as const)('answers 403 to %s %s without its step-up', async (method, path, body) => {
    const { call, calls } = setup({ approved: false });
    const response = await call(method, path, body);
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('step_up_required');
    expect(calls).toEqual([]);
  });

  it('binds a rotation to the recipient it rotates and the new one', async () => {
    const { call, calls, spent } = setup();
    expect((await call('POST', '/vault/rotate', rotateBody)).status).toBe(200);
    expect(spent).toEqual([
      {
        purpose: 'sensitive_settings',
        action: {
          action: 'rotateVaultIdentity',
          targets: [rotateBody.from],
          fields: { recipient },
          nonce,
        },
      },
    ]);
    expect(calls).toEqual([['rotate', owner.accountId, rotateBody]]);
  });

  it.each([
    ['no_vault', 404, 'not_found'],
    ['changed', 409, 'vault_changed'],
    ['unknown_passkey', 400, 'invalid_request'],
  ] as const)('answers a %s rotation with %i', async (outcome, status, code) => {
    const response = await setup({ rotated: outcome }).call('POST', '/vault/rotate', rotateBody);
    expect(response.status).toBe(status);
    expect(await errorOf(response)).toBe(code);
  });

  it('binds a re-seal to the recipients in order', async () => {
    const { call, calls, spent } = setup();
    expect((await call('PUT', '/vault/recovery-envelopes', resealBody)).status).toBe(200);
    expect(spent).toEqual([
      {
        purpose: 'sensitive_settings',
        action: { action: 'resealVaultRecovery', targets: recipientIds, nonce },
      },
    ]);
    expect(calls).toEqual([['resealRecovery', owner.accountId, resealBody]]);
  });

  it.each([
    ['no_vault', 404, 'not_found'],
    ['changed', 409, 'vault_changed'],
  ] as const)('answers a %s re-seal with %i', async (outcome, status, code) => {
    const response = await setup({ resealed: outcome }).call(
      'PUT',
      '/vault/recovery-envelopes',
      resealBody,
    );
    expect(response.status).toBe(status);
    expect(await errorOf(response)).toBe(code);
  });

  it('refuses a re-seal naming one recipient twice', async () => {
    const { call, calls } = setup();
    const body = { envelopes: [resealBody.envelopes[0], resealBody.envelopes[0]] };
    expect((await call('PUT', '/vault/recovery-envelopes', body)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('resets the vault after its step-up, and 404 with nothing to reset', async () => {
    const { call, calls, spent } = setup();
    expect((await call('DELETE', '/vault', {})).status).toBe(200);
    expect(spent).toEqual([
      { purpose: 'sensitive_settings', action: { action: 'resetVault', targets: [], nonce } },
    ]);
    expect(calls).toEqual([['reset', owner.accountId]]);
    expect((await setup({ stored: false }).call('DELETE', '/vault', {})).status).toBe(404);
  });

  it('refuses a reset with 409 while the account owns a document', async () => {
    const response = await setup({ reset: 'has_documents' }).call('DELETE', '/vault', {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'vault_has_documents' } });
  });
});

const storeBody = { recipient, expectedVersion: 2, sharingState: taggedState };

describe('sharing state and account links (spec 0005, R4)', () => {
  it('serves the stored sharing state, or null before the first, without a window', async () => {
    const response = await setup({ unlocked: false }).call('GET', '/vault/sharing-state');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sharingState: taggedState });
    const none = await setup({ stored: false }).call('GET', '/vault/sharing-state');
    expect(await none.json()).toEqual({ sharingState: null });
  });

  it('stores a sharing state only within a vault_unlock window', async () => {
    const refused = setup({ unlocked: false });
    const response = await refused.call('PUT', '/vault/sharing-state', storeBody);
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('step_up_required');
    expect(refused.calls).toEqual([]);
    const { call, calls } = setup();
    expect((await call('PUT', '/vault/sharing-state', storeBody)).status).toBe(200);
    expect(calls).toEqual([['storeSharingState', owner.accountId, storeBody]]);
  });

  it.each([
    ['no_vault', 404, 'not_found'],
    ['vault_changed', 409, 'vault_changed'],
    ['changed', 409, 'sharing_state_changed'],
  ] as const)('answers a %s store with %i %s', async (outcome, status, code) => {
    const response = await setup({ storedState: outcome }).call(
      'PUT',
      '/vault/sharing-state',
      storeBody,
    );
    expect(response.status).toBe(status);
    expect(await errorOf(response)).toBe(code);
  });

  it.each([
    ['a version not above the one it replaces', { ...storeBody, expectedVersion: 3 }],
    [
      'a first version of 0',
      { ...storeBody, expectedVersion: null, sharingState: { ...taggedState, version: 0 } },
    ],
    ['a short tag', { ...storeBody, sharingState: { ...taggedState, tag: 'AAAA' } }],
    [
      'a state that is not base64url',
      { ...storeBody, sharingState: { ...taggedState, state: 'a+b/' } },
    ],
    ['a classic recipient', { ...storeBody, recipient: `age1${'q'.repeat(58)}` }],
    ['an extra field', { ...storeBody, documents: {} }],
  ])('refuses a sharing state with %s', async (_, body) => {
    const { call, calls } = setup();
    expect((await call('PUT', '/vault/sharing-state', body)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("lists the account's links with their recipients", async () => {
    const { call, calls } = setup({ unlocked: false });
    const response = await call('GET', '/account/links');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ links });
    expect(calls).toEqual([['links', owner.accountId]]);
  });
});
