import { describe, expect, it } from 'vitest';
import type { AccountDeletion } from '../src/account/deletion.js';
import { createApp } from '../src/app.js';
import type { Devices } from '../src/auth/devices.js';
import type { SignedIn } from '../src/auth/service.js';
import type { CanonicalAction } from '../src/auth/step-up-encoding.js';
import type { StepUpService } from '../src/auth/step-up.js';
import type { Logger } from '@arca/telemetry';
import { noLimits } from './limits.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const owner: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const nonce = 'MzMzMzMzMzMzMzMzMzMzMw';
const dueAt = new Date('2026-11-11T14:00:00.000Z');
const session = {
  accountId: owner.accountId,
  email: 'owner@example.com',
  confirmed: true,
  device: { browser: 'firefox' as const, os: 'linux' as const },
};

function setup({
  approved = true,
  pending = null,
  cancelled = true,
  recoveryPending = false,
}: {
  approved?: boolean;
  pending?: Date | null;
  cancelled?: boolean;
  recoveryPending?: boolean;
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
  const accountDeletion: AccountDeletion = {
    request: (accountId) => {
      calls.push(`request ${accountId}`);
      return Promise.resolve(dueAt);
    },
    cancel: (accountId) => {
      calls.push(`cancel ${accountId}`);
      return Promise.resolve(cancelled);
    },
  };
  const devices = {
    list: () => {
      calls.push('list');
      return Promise.resolve({ passkeys: [] });
    },
    status: () =>
      Promise.resolve({
        pendingUntil: null,
        recoveryPending,
        deletionDueAt: pending,
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
    accountDeletion,
  });
  const call = (method: 'POST' | 'DELETE' | 'GET', path: string) =>
    app.request(`/v1${path}`, {
      method,
      headers: {
        origin,
        cookie: 'session=1',
        'content-type': 'application/json',
        'arca-step-up-nonce': nonce,
      },
      ...(method === 'GET' ? {} : { body: '{}' }),
    });
  return { call, calls, spent };
}

const action = (name: string) => ({
  action: name,
  targets: [],
  nonce: new Uint8Array(Buffer.from(nonce, 'base64url')),
});

describe('account deletion routes (spec 0004, R9)', () => {
  it('requests the deletion after an account_deletion step-up and answers the due time', async () => {
    const { call, calls, spent } = setup();
    const response = await call('POST', '/account/deletion');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ dueAt: dueAt.toISOString() });
    expect(calls).toEqual([`request ${owner.accountId}`]);
    expect(spent).toEqual([
      { purpose: 'account_deletion', action: action('requestAccountDeletion') },
    ]);
  });

  it('cancels it after its own step-up', async () => {
    const { call, calls, spent } = setup({ pending: dueAt });
    expect((await call('DELETE', '/account/deletion')).status).toBe(200);
    expect(calls).toEqual([`cancel ${owner.accountId}`]);
    expect(spent).toEqual([
      { purpose: 'account_deletion', action: action('cancelAccountDeletion') },
    ]);
  });

  it.each([
    ['POST', null],
    ['DELETE', dueAt],
  ] as const)('answers 403 to %s without a fresh step-up', async (method, pending) => {
    const { call, calls } = setup({ approved: false, pending });
    const response = await call(method, '/account/deletion');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'step_up_required' } });
    expect(calls).toEqual([]);
  });

  it('answers 404 to a cancel with nothing to cancel', async () => {
    const { call } = setup({ cancelled: false, pending: dueAt });
    const response = await call('DELETE', '/account/deletion');
    expect(response.status).toBe(404);
  });

  it('lets a session whose account waits for deletion only show so and cancel it', async () => {
    const { call, calls } = setup({ pending: dueAt });
    const shown = await call('GET', '/session');
    expect(await shown.json()).toMatchObject({ deletionDueAt: dueAt.toISOString() });
    const listed = await call('GET', '/devices');
    expect(listed.status).toBe(403);
    expect(await listed.json()).toEqual({ error: { code: 'deletion_pending' } });
    expect((await call('POST', '/account/deletion')).status).toBe(403);
    expect((await call('DELETE', '/account/deletion')).status).toBe(200);
    expect(calls).toEqual([`cancel ${owner.accountId}`]);
  });

  it('keeps the recovery cancel and the deletion cancel open while both wait', async () => {
    const { call, calls } = setup({ pending: dueAt, recoveryPending: true });
    expect((await call('GET', '/devices')).status).toBe(200);
    expect((await call('DELETE', '/account/deletion')).status).toBe(200);
    const requested = await call('POST', '/account/deletion');
    expect(requested.status).toBe(403);
    expect(await requested.json()).toEqual({ error: { code: 'recovery_pending' } });
    expect(calls).toEqual(['list', `cancel ${owner.accountId}`]);
  });

  it('shows no deletion when none waits', async () => {
    const { call } = setup();
    expect(await (await call('GET', '/session')).json()).toMatchObject({ deletionDueAt: null });
    expect((await call('GET', '/devices')).status).toBe(200);
  });
});
