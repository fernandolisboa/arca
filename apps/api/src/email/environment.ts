import type { Database } from '@arca/db';
import type { DeploymentEnvironment } from '../config.js';
import { unconfiguredSender, type EmailSender } from './email.js';
import { outboxSender, readOutbox, type OutboxEntry } from './outbox.js';

/**
 * The sender each environment uses (spec 0003, R8): the outbox everywhere but production, which
 * sends nothing until its sending domain is configured (spec 0003, R9). The database is opened on
 * the first message.
 */
export function emailSenderFor(
  environment: DeploymentEnvironment,
  db: () => Database,
): EmailSender {
  if (environment === 'production') return unconfiguredSender;
  return { send: (message) => outboxSender(db(), environment).send(message) };
}

/** The reader behind `/internal/outbox`, which exists on previews only (spec 0003, R8). */
export function outboxReaderFor(
  environment: DeploymentEnvironment,
  db: () => Database,
): (() => Promise<OutboxEntry[]>) | undefined {
  if (environment !== 'preview') return undefined;
  return () => readOutbox(db(), environment);
}
