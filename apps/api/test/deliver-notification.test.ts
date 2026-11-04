import { describe, expect, it, vi } from 'vitest';
import { deliverNow, type Delivery } from '../src/notification/delivery.js';
import { deliverNotification } from '../src/workflows/deliver-notification.js';
import { entityId } from '../src/workflows/workflow-arguments.js';

const channels = ['5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a', '6e5d4c3b-2a1f-4e0d-9c8b-7a6f5e4d3c2b'];
const { order } = vi.hoisted(() => ({ order: [] as string[] }));

vi.mock('../src/workflows/notification-steps.js', () => ({
  pendingChannels: () => {
    order.push('pendingChannels');
    return Promise.resolve(channels);
  },
  deliverOnChannel: (_accountId: string, _messageId: string, channelId: string) => {
    order.push(`deliver:${channelId}`);
    return Promise.resolve();
  },
}));

const accountId = '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b';
const messageId = '4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d';

describe('deliverNotification (spec 0005, R7)', () => {
  it('runs one step per pending channel, in the order deliverNow runs them', async () => {
    order.length = 0;
    await deliverNotification(entityId(accountId), entityId(messageId));
    const calls: string[] = [];
    const delivery: Delivery = {
      pendingChannels: () => {
        calls.push('pendingChannels');
        return Promise.resolve(channels);
      },
      deliver: (_accountId, _messageId, channelId) => {
        calls.push(`deliver:${channelId}`);
        return Promise.resolve();
      },
    };
    await deliverNow(delivery, accountId, messageId);
    expect(order).toEqual(calls);
    expect(calls).toHaveLength(3);
  });
});
