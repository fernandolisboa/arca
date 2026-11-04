import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Devices, PasskeyRevocation } from '../src/auth/devices.js';
import type { SignedIn } from '../src/auth/service.js';
import type { CanonicalAction } from '../src/auth/step-up-encoding.js';
import type { StepUpService } from '../src/auth/step-up.js';
import type { Logger } from '../src/logger.js';
import { noLimits } from './limits.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const owner: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const targetId = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const nonce = 'MzMzMzMzMzMzMzMzMzMzMw';

function setup({
  signedIn = owner,
  approved = true,
  found = true,
  passkey = 'revoked',
}: {
  signedIn?: SignedIn | null;
  approved?: boolean;
  found?: boolean;
  passkey?: PasskeyRevocation;
} = {}) {
  const calls: string[] = [];
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
  };
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(signedIn),
      refresh: () => Promise.resolve({ session: null, setCookies: [] }),
    },
    authLimits: noLimits,
    stepUp,
    devices,
  });
  const post = (path: string, body: unknown) =>
    app.request(`/v1/devices/${path}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'arca-step-up-nonce': nonce },
      body: JSON.stringify(body),
    });
  return { app, post, calls, spent };
}

const revocations = [
  ['sessions/revoke', 'revokeSession', { sessionId: targetId }, [targetId]],
  ['passkeys/revoke', 'revokePasskey', { passkeyId: targetId }, [targetId]],
  ['sessions/revoke-others', 'revokeOtherSessions', {}, []],
] as const;

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
    for (const [path, , body] of revocations) expect((await post(path, body)).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it.each(revocations)(
    'spends a step-up bound to %s and its target before revoking',
    async (path, action, body, targets) => {
      const { post, calls, spent } = setup();
      const response = await post(path, body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
      expect(spent).toHaveLength(1);
      expect(spent[0]?.purpose).toBe('sensitive_settings');
      expect(spent[0]?.action).toMatchObject({ action, targets });
      expect(Buffer.from(spent[0]?.action.nonce ?? []).toString('base64url')).toBe(nonce);
      expect(calls).toHaveLength(1);
    },
  );

  it.each(revocations)('answers 403 to %s without a step-up for it', async (path, _, body) => {
    const { post, calls } = setup({ approved: false });
    const response = await post(path, body);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'step_up_required' } });
    expect(calls).toEqual([]);
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

  it('answers 400 to a target that is not an ID', async () => {
    const { post, calls, spent } = setup();
    expect((await post('sessions/revoke', { sessionId: 'not-an-id' })).status).toBe(400);
    expect((await post('sessions/revoke-others', { sessionId: targetId })).status).toBe(400);
    expect(calls).toEqual([]);
    expect(spent).toEqual([]);
  });
});
