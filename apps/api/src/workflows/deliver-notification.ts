import { deliverOnChannel, pendingChannels } from './notification-steps.js';
import type { EntityId } from './workflow-arguments.js';

/**
 * Delivers a message on each of its account's channels (spec 0005, R7). Each channel is its own
 * step and records its own delivery, so a retry only sends to the channels not yet reached.
 */
export async function deliverNotification(accountId: EntityId, messageId: EntityId): Promise<void> {
  'use workflow';
  for (const channelId of await pendingChannels(accountId, messageId)) {
    await deliverOnChannel(accountId, messageId, channelId);
  }
}
