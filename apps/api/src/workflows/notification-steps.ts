import { entityId, type EntityId } from './workflow-arguments.js';
import { withStepError } from './step-error.js';
import { deliverySteps, stepTelemetry } from './step-context.js';

export async function pendingChannels(
  accountId: EntityId,
  messageId: EntityId,
): Promise<EntityId[]> {
  'use step';
  const channels = await withStepError('database_unavailable', stepTelemetry, async () =>
    (await deliverySteps()).pendingChannels(accountId, messageId),
  );
  return channels.map(entityId);
}

export async function deliverOnChannel(
  accountId: EntityId,
  messageId: EntityId,
  channelId: EntityId,
): Promise<void> {
  'use step';
  await withStepError('email_unavailable', stepTelemetry, async () =>
    (await deliverySteps()).deliver(accountId, messageId, channelId),
  );
}
