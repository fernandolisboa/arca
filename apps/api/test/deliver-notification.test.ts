import type { Logger } from '@arca/telemetry';
import { describe, expect, it, vi } from 'vitest';
import { deliverNow, PushFailedError, type Delivery } from '../src/notification/delivery.js';
import { deliverNotification } from '../src/workflows/deliver-notification.js';
import { entityId } from '../src/workflows/workflow-arguments.js';

const channels = ['5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a', '6e5d4c3b-2a1f-4e0d-9c8b-7a6f5e4d3c2b'];
const { order, failingChannel } = vi.hoisted(() => ({
  order: [] as string[],
  failingChannel: { id: '' },
}));

vi.mock('../src/workflows/notification-steps.js', () => ({
  pendingChannels: () => {
    order.push('pendingChannels');
    return Promise.resolve(channels);
  },
  deliverOnChannel: (_accountId: string, _messageId: string, channelId: string) => {
    order.push(`deliver:${channelId}`);
    return channelId === failingChannel.id
      ? Promise.reject(new Error('delivery_unavailable'))
      : Promise.resolve();
  },
}));

const accountId = '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b';
const messageId = '4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d';
const silentLogger: Logger = { info: () => undefined, error: () => undefined };

function delivering(failure?: { channelId: string; error: Error }) {
  const calls: string[] = [];
  const delivery: Delivery = {
    pendingChannels: () => {
      calls.push('pendingChannels');
      return Promise.resolve(channels);
    },
    deliver: (_accountId, _messageId, channelId) => {
      calls.push(`deliver:${channelId}`);
      return channelId === failure?.channelId ? Promise.reject(failure.error) : Promise.resolve();
    },
  };
  return { calls, delivery };
}

describe('deliverNotification (spec 0005, R7)', () => {
  it('runs one step per pending channel, in the order deliverNow runs them', async () => {
    order.length = 0;
    failingChannel.id = '';
    await deliverNotification(entityId(accountId), entityId(messageId));
    const { calls, delivery } = delivering();
    await deliverNow(delivery, accountId, messageId, silentLogger);
    expect(order).toEqual(calls);
    expect(calls).toHaveLength(3);
  });

  it('still reaches the other channels when one fails, then fails the run for the retry', async () => {
    order.length = 0;
    failingChannel.id = channels[0] ?? '';
    await expect(deliverNotification(entityId(accountId), entityId(messageId))).rejects.toThrow(
      'delivery_unavailable',
    );
    expect(order).toContain(`deliver:${String(channels[1])}`);
  });
});

describe('deliverNow', () => {
  it('logs a failed push and goes on to the next channel', async () => {
    const errors: unknown[] = [];
    const logger: Logger = { info: () => undefined, error: (entry) => errors.push(entry) };
    const cause = new TypeError('fetch failed');
    const { calls, delivery } = delivering({
      channelId: channels[0] ?? '',
      error: new PushFailedError('push failed', { cause }),
    });
    await deliverNow(delivery, accountId, messageId, logger);
    expect(calls).toHaveLength(3);
    expect(errors).toEqual([{ errorName: 'notification_push_failed:TypeError' }]);
  });

  it('lets any other failure through, so the account is not marked unwarned', async () => {
    const { delivery } = delivering({
      channelId: channels[0] ?? '',
      error: new Error('email unavailable'),
    });
    await expect(deliverNow(delivery, accountId, messageId, silentLogger)).rejects.toThrow(
      'email unavailable',
    );
  });
});
