import { deliverOnChannel, pendingChannels } from './notification-steps.js';
import type { EntityId } from './workflow-arguments.js';

/**
 * Delivers a message on each of its account's channels (spec 0005, R7). Each channel is its own
 * step and records its own delivery, so a retry only sends to the channels not yet reached, and a
 * channel that keeps failing holds back none of the others.
 */
export async function deliverNotification(accountId: EntityId, messageId: EntityId): Promise<void> {
  'use workflow';
  const channels = await pendingChannels(accountId, messageId);
  const outcomes = await Promise.allSettled(
    channels.map((channelId) => deliverOnChannel(accountId, messageId, channelId)),
  );
  const failed = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failed !== undefined) throw failed.reason;
}
