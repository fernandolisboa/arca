import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Devices, PasskeyRevocation } from '../src/auth/devices.js';
import type { SignedIn } from '../src/auth/service.js';
import type { CanonicalAction } from '../src/auth/step-up-encoding.js';
import type { StepUpService } from '../src/auth/step-up.js';
import type { Logger } from '@arca/telemetry';
import { noLimits } from './limits.js';
import { attestation, creationOptions } from './passkey-fixtures.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const owner: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const targetId = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const nonce = 'MzMzMzMzMzMzMzMzMzMzMw';
const challengeId = '7b6a5f4e-3d2c-4b1a-9f8e-7d6c5b4a3f2e';
const addOptions = { challengeId, options: creationOptions };
const activeFrom = new Date('2026-11-05T09:00:00.000Z');
const session = {
  accountId: owner.accountId,
  email: 'owner@example.com',
  confirmed: true,
  device: { browser: 'firefox' as const, os: 'linux' as const },
};

function setup({
  signedIn = owner,
  approved = true,
  found = true,
  passkey = 'revoked',
  accepted = true,
  pendingUntil = null,
  recoveryPending = false,
  sessionEnded = false,
  allowed = true,
}: {
  signedIn?: SignedIn | null;
  approved?: boolean;
  found?: boolean;
  passkey?: PasskeyRevocation;
  accepted?: boolean;
  pendingUntil?: Date | null;
  recoveryPending?: boolean;
  sessionEnded?: boolean;
  allowed?: boolean;
} = {}) {
  const calls: string[] = [];
  const checked: string[] = [];
  const spent: { purpose: string; action: CanonicalAction }[] = [];
  const stepUp: StepUpService = {
    options: () => Promise.reject(new Error('unused')),
    verify: () => Promise.reject(new Error('unused')),
    consume: (_, purpose, action) => {
      spent.push({ purpose, action });
      return Promise.resolve(approved);
    },
    vaultUnlocked: () => Promise.resolve(false),
  };
  const devices: Devices = {
    list: (current) => {
      calls.push(`list ${current.sessionId}`);
      return Promise.resolve({ passkeys: [] });
    },
    revokeSession: (current, id) => {
      calls.push(`revokeSession ${current.sessionId} ${id}`);
      return Promise.resolve(found);
    },
    revokePasskey: (current, id) => {
      calls.push(`revokePasskey ${current.sessionId} ${id}`);
      return Promise.resolve(passkey);
    },
    revokeOtherSessions: (current) => {
      calls.push(`revokeOtherSessions ${current.sessionId}`);
      return Promise.resolve();
    },
    addOptions: (current) => {
      calls.push(`addOptions ${current.sessionId}`);
      return Promise.resolve(addOptions);
    },
    add: (current, challengeId) => {
      calls.push(`add ${current.sessionId} ${challengeId}`);
      return Promise.resolve(accepted);
    },
    status: (accountId) => {
      checked.push(accountId);
      return Promise.resolve({ pendingUntil, recoveryPending, deletionDueAt: null, sessionEnded });
    },
  };
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => {
        calls.push('auth');
        return Promise.resolve(Response.json({}));
      },
      signedIn: () => Promise.resolve(signedIn),
      refresh: () =>
        Promise.resolve({ session: signedIn === null ? null : session, setCookies: [] }),
    },
    authLimits: allowed
      ? noLimits
      : {
          ...noLimits,
          limiter: {
            hit: () => Promise.resolve({ allowed: false, retryAfterSeconds: 60 }),
          },
        },
    stepUp,
    devices,
  });
  const post = (path: string, body: unknown) =>
    app.request(`/v1/devices/${path}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'arca-step-up-nonce': nonce },
      body: JSON.stringify(body),
    });
  return { app, post, calls, checked, spent };
}

const revocations = [
  ['sessions/revoke', 'revokeSession', { sessionId: targetId }, [targetId]],
  ['passkeys/revoke', 'revokePasskey', { passkeyId: targetId }, [targetId]],
  ['sessions/revoke-others', 'revokeOtherSessions', {}, []],
] as const;
const stepUpRoutes = [...revocations, ['passkeys/options', 'addPasskeyOptions', {}, []]] as const;

describe('the device routes (spec 0003, R4)', () => {
  it('lists the devices of the signed-in session', async () => {
    const { app, calls } = setup();
    const response = await app.request('/v1/devices');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ passkeys: [] });
    expect(calls).toEqual([`list ${owner.sessionId}`]);
  });

  it('answers 401 without a session', async () => {
    const { app, post, calls } = setup({ signedIn: null });
    expect((await app.request('/v1/devices')).status).toBe(401);
    for (const [path, , body] of stepUpRoutes) expect((await post(path, body)).status).toBe(401);
    expect((await post('passkeys/add', { challengeId, response: attestation })).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it.each(stepUpRoutes)(
    'spends a step-up bound to %s and its target before acting',
    async (path, action, body, targets) => {
      const { post, calls, spent } = setup();
      const response = await post(path, body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(path === 'passkeys/options' ? addOptions : {});
      expect(spent).toHaveLength(1);
      expect(spent[0]?.purpose).toBe('sensitive_settings');
      expect(spent[0]?.action).toMatchObject({ action, targets });
      expect(Buffer.from(spent[0]?.action.nonce ?? []).toString('base64url')).toBe(nonce);
      expect(calls).toHaveLength(1);
    },
  );

  it.each(stepUpRoutes)('answers 403 to %s without a step-up for it', async (path, _, body) => {
    const { post, calls } = setup({ approved: false });
    const response = await post(path, body);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'step_up_required' } });
    expect(calls).toEqual([]);
  });

  it('no longer offers a knowledge_decision step-up (ADR-0027)', async () => {
    const { app } = setup();
    const target = {
      action: 'activateVersion',
      targets: ['pt-d7', '2'],
      fields: { contentHash: 'a'.repeat(64) },
      nonce,
    };
    const response = await app.request('/v1/auth/step-up/options', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'knowledge_decision', target }),
    });
    expect(response.status).toBe(400);
  });

  it("answers 404 to a session or passkey that is not the account's", async () => {
    expect(
      (await setup({ found: false }).post('sessions/revoke', { sessionId: targetId })).status,
    ).toBe(404);
    expect(
      (await setup({ passkey: 'not_found' }).post('passkeys/revoke', { passkeyId: targetId }))
        .status,
    ).toBe(404);
  });

  it('answers 409 to removing the last active passkey', async () => {
    const response = await setup({ passkey: 'last_active' }).post('passkeys/revoke', {
      passkeyId: targetId,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: 'last_active_passkey' } });
  });

  it('answers 403 to removing another passkey while a recovery passkey waits', async () => {
    const response = await setup({ passkey: 'recovery_pending' }).post('passkeys/revoke', {
      passkeyId: targetId,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'recovery_pending' } });
  });

  it('answers 400 to a target that is not an ID', async () => {
    const { post, calls, spent } = setup();
    expect((await post('sessions/revoke', { sessionId: 'not-an-id' })).status).toBe(400);
    expect((await post('sessions/revoke-others', { sessionId: targetId })).status).toBe(400);
    expect(calls).toEqual([]);
    expect(spent).toEqual([]);
  });

  it('stores a new passkey for the challenge of this session', async () => {
    const { post, calls, spent } = setup();
    const response = await post('passkeys/add', { challengeId, response: attestation });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(calls).toEqual([`add ${owner.sessionId} ${challengeId}`]);
    expect(spent).toEqual([]);
  });

  it('answers 429 to a new passkey over the session limit', async () => {
    const { post, calls } = setup({ allowed: false });
    const response = await post('passkeys/add', { challengeId, response: attestation });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(calls).toEqual([]);
  });

  it('answers 403 passkey_refused to a passkey it does not store', async () => {
    const response = await setup({ accepted: false }).post('passkeys/add', {
      challengeId,
      response: attestation,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'passkey_refused' } });
  });

  it('shows every session when a pending passkey becomes active', async () => {
    const pending = setup({ pendingUntil: activeFrom });
    const response = await pending.app.request('/v1/session');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...session,
      pendingPasskeyUntil: activeFrom.toISOString(),
      recoveryPending: false,
      deletionDueAt: null,
      admin: false,
    });
    expect(pending.checked).toEqual([owner.accountId]);
    const none = await setup().app.request('/v1/session');
    expect(await none.json()).toEqual({
      ...session,
      pendingPasskeyUntil: null,
      recoveryPending: false,
      deletionDueAt: null,
      admin: false,
    });
  });

  it('restricts a session while a recovery passkey waits (spec 0003, R6)', async () => {
    const restricted = setup({ recoveryPending: true });
    const headers = { origin, cookie: 'session=1', 'content-type': 'application/json' };
    const shown = await restricted.app.request('/v1/session', { headers });
    expect(shown.status).toBe(200);
    expect(await shown.json()).toMatchObject({ recoveryPending: true });
    expect((await restricted.app.request('/v1/devices', { headers })).status).toBe(200);
    const refused = await restricted.app.request('/v1/devices/sessions/revoke-others', {
      method: 'POST',
      headers,
      body: '{}',
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: { code: 'recovery_pending' } });
    expect(restricted.calls).toEqual([`list ${owner.sessionId}`]);
  });

  it('keeps signing out and step-ups open to a restricted session', async () => {
    const restricted = setup({ recoveryPending: true });
    const headers = { origin, cookie: 'session=1', 'content-type': 'application/json' };
    const signOut = await restricted.app.request('/v1/auth/sign-out', {
      method: 'POST',
      headers,
      body: '{}',
    });
    expect(signOut.status).not.toBe(403);
    expect(restricted.calls).toEqual(['auth']);
    const stepUp = await restricted.app.request('/v1/auth/step-up/options', {
      method: 'POST',
      headers,
      body: JSON.stringify({ purpose: 'vault_unlock' }),
    });
    expect(stepUp.status).not.toBe(403);
  });

  it('answers 401 to a session that an activation just ended', async () => {
    const ended = setup({ sessionEnded: true });
    const headers = { origin, cookie: 'session=1' };
    expect((await ended.app.request('/v1/devices', { headers })).status).toBe(401);
    expect(ended.calls).toEqual([]);
  });
});
