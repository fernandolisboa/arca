import { deliverNotification } from './deliver-notification.js';
import { startWorkflow } from './start-workflow.js';
import { entityId } from './workflow-arguments.js';

/** Starts the delivery of a recorded message, with identifiers only (spec 0005, R7). */
export const startDelivery = (accountId: string, messageId: string) =>
  startWorkflow(deliverNotification, [entityId(accountId), entityId(messageId)]);
