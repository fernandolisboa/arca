import { describe, expect, it } from 'vitest';
import type { NotificationChannel } from '@arca/api-contract/routes';
import type { Logger } from '@arca/telemetry';
import { createApp } from '../src/app.js';
import type { SignedIn } from '../src/auth/service.js';
import type { StepUpService } from '../src/auth/step-up.js';
import type { CanonicalAction } from '../src/auth/step-up-encoding.js';
import type { NotificationChannels } from '../src/notification/channels.js';
import type { RateLimitRule } from '../src/auth/rate-limit.js';
import { noLimits } from './limits.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const owner: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const pushKey = `B${'A'.repeat(86)}`;
const channelId = '0b4f6a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b';
const nonceHeader = 'MzMzMzMzMzMzMzMzMzMzMw';
const nonce = new Uint8Array(Buffer.from(nonceHeader, 'base64url'));
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-subscription',
  p256dh: `B${'C'.repeat(86)}`,
  auth: 'D'.repeat(22),
  device: { browser: 'chrome', os: 'android' },
};
const channel: NotificationChannel = {
  id: channelId,
  kind: 'web_push',
  browser: 'chrome',
  os: 'android',
  createdAt: '2026-11-04T15:30:00.000Z',
  lastSuccessAt: null,
};

function setup({
  key = pushKey,
  approved = true,
  removed = true,
  signedIn = true,
  full = false,
  limited = false,
}: {
  key?: string | null;
  approved?: boolean;
  removed?: boolean;
  signedIn?: boolean;
  full?: boolean;
  limited?: boolean;
} = {}) {
  const calls: unknown[] = [];
  const hits: { rule: string; subject: string }[] = [];
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
  const channels: NotificationChannels = {
    list: (accountId) => {
      calls.push(['list', accountId]);
      return Promise.resolve([channel]);
    },
    addPush: (accountId, request) => {
      calls.push(['addPush', accountId, request]);
      return Promise.resolve(full ? 'too_many' : { channelId });
    },
    removePush: (accountId, id) => {
      calls.push(['removePush', accountId, id]);
      return Promise.resolve(removed);
    },
  };
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(signedIn ? owner : null),
      refresh: () => Promise.reject(new Error('unused')),
    },
    authLimits: limited ? { ...noLimits, limiter: refuseAll(hits) } : noLimits,
    stepUp,
    notifications: { channels, pushKey: key },
  });
  const call = (method: 'GET' | 'POST', path: string, body?: unknown) =>
    app.request(`/v1${path}`, {
      method,
      headers: {
        origin,
        cookie: 'session=1',
        'content-type': 'application/json',
        'arca-step-up-nonce': nonceHeader,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { call, calls, spent, hits };
}

function refuseAll(hits: { rule: string; subject: string }[]) {
  return {
    hit: (rule: RateLimitRule, subject: string) => {
      hits.push({ rule: rule.name, subject });
      return Promise.resolve({ allowed: false as const, retryAfterSeconds: 60 });
    },
  };
}

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('notification channel routes (spec 0005, R7)', () => {
  it("lists the account's channels with the environment's push key", async () => {
    const { call, calls } = setup();
    const response = await call('GET', '/notifications/channels');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ channels: [channel], pushKey });
    expect(calls).toEqual([['list', owner.accountId]]);
  });

  it.each([
    ['GET', '/notifications/channels', undefined],
    ['POST', '/notifications/channels', subscription],
    ['POST', '/notifications/channels/remove', { channelId }],
  ] as const)('answers 401 to %s %s without a session', async (method, path, body) => {
    const { call, calls } = setup({ signedIn: false });
    expect((await call(method, path, body)).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('adds this browser’s subscription for the signed-in account', async () => {
    const { call, calls } = setup();
    const response = await call('POST', '/notifications/channels', subscription);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ channelId });
    expect(calls).toEqual([['addPush', owner.accountId, subscription]]);
  });

  it('answers 409 too_many_push_channels once the account has its maximum', async () => {
    const { call } = setup({ full: true });
    const response = await call('POST', '/notifications/channels', subscription);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('too_many_push_channels');
  });

  it('limits adding per account', async () => {
    const { call, calls, hits } = setup({ limited: true });
    const response = await call('POST', '/notifications/channels', subscription);
    expect(response.status).toBe(429);
    expect(hits).toEqual([{ rule: 'add_push_channel_account', subject: owner.accountId }]);
    expect(calls).toEqual([]);
  });

  it('answers 503 push_unavailable where push is not set up', async () => {
    const { call, calls } = setup({ key: null });
    const response = await call('POST', '/notifications/channels', subscription);
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe('push_unavailable');
    expect(calls).toEqual([]);
  });

  it.each([
    ['plain http', 'http://fcm.googleapis.com/fcm/send/x'],
    ['a host that is no push service', 'https://push.example.com/send/x'],
    ['a look-alike host', 'https://fcm.googleapis.com.example.com/send/x'],
    ['an internal address', 'https://169.254.169.254/latest/meta-data'],
    ['an explicit port', 'https://fcm.googleapis.com:8443/fcm/send/x'],
    ['credentials in the URL', 'https://user:secret@fcm.googleapis.com/fcm/send/x'],
  ])('refuses a subscription with %s', async (_, endpoint) => {
    const { call, calls } = setup();
    const response = await call('POST', '/notifications/channels', { ...subscription, endpoint });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it.each([
    'https://web.push.apple.com/synthetic',
    'https://wns2-par02p.notify.windows.com/w/?token=synthetic',
    'https://updates.push.services.mozilla.com/wpush/v2/synthetic',
  ])('accepts the push service at %s', async (endpoint) => {
    const { call } = setup();
    expect(
      (await call('POST', '/notifications/channels', { ...subscription, endpoint })).status,
    ).toBe(200);
  });

  it('removes a channel only after a sensitive_settings step-up bound to it', async () => {
    const { call, calls, spent } = setup();
    expect((await call('POST', '/notifications/channels/remove', { channelId })).status).toBe(200);
    expect(spent).toEqual([
      {
        purpose: 'sensitive_settings',
        action: { action: 'removeNotificationChannel', targets: [channelId], nonce },
      },
    ]);
    expect(calls).toEqual([['removePush', owner.accountId, channelId]]);
  });

  it('refuses to remove a channel without a step-up', async () => {
    const { call, calls } = setup({ approved: false });
    const response = await call('POST', '/notifications/channels/remove', { channelId });
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('step_up_required');
    expect(calls).toEqual([]);
  });

  it('answers 404 for an unknown or email channel', async () => {
    const { call } = setup({ removed: false });
    const response = await call('POST', '/notifications/channels/remove', { channelId });
    expect(response.status).toBe(404);
  });
});
