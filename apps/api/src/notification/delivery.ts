import { withIdentity, type Database, type Transaction } from '@arca/db';
import type { Logger } from '@arca/telemetry';
import { sql } from 'drizzle-orm';
import { accounts } from '../auth/auth.js';
import type { Notices } from '../email/notices.js';
import { checkedCode, noticeOf } from './notification.js';
import type { PushSender } from './push.js';

/** The steps of `deliverNotification` (spec 0005, R7), each under the account's identity. */
export interface Delivery {
  /** The account's channels the message has not reached, its email channel created and first. */
  pendingChannels(accountId: string, messageId: string): Promise<string[]>;
  /** Sends the message on the channel and records the delivery; a channel reached is skipped. */
  deliver(accountId: string, messageId: string, channelId: string): Promise<void>;
}

export interface DeliveryDependencies {
  /** The app_jobs pool. */
  readonly jobsDb: Database;
  /** The app_auth pool, where the address stays. */
  readonly authDb: Database;
  readonly notices: Notices;
  /** Absent where the environment has no VAPID key: push channels then wait, undelivered. */
  readonly push?: PushSender;
  readonly logger: Logger;
}

/** A push that failed for a reason that may pass, such as a slow or busy push service. */
export class PushFailedError extends Error {
  override name = 'PushFailedError';
}

interface PendingRow {
  code: string;
  details: unknown;
  created_at: Date;
  kind: 'email' | 'web_push';
  endpoint: string | null;
  p256dh: string | null;
  auth_secret: string | null;
}

export function createDelivery({
  jobsDb,
  authDb,
  notices,
  push,
  logger,
}: DeliveryDependencies): Delivery {
  const asAccount = <T>(accountId: string, work: (tx: Transaction) => Promise<T>) =>
    withIdentity(jobsDb, { accountId }, work);

  return {
    pendingChannels: (accountId, messageId) =>
      asAccount(accountId, async (tx) => {
        // Only while the message exists, so an erased account gets no channel back.
        await tx.execute(sql`
          INSERT INTO notification.channel (account_id, kind)
          SELECT ${accountId}, 'email'
           WHERE EXISTS (SELECT FROM notification.message WHERE id = ${messageId})
          ON CONFLICT (account_id) WHERE kind = 'email' DO NOTHING`);
        const result = await tx.execute<{ id: string }>(sql`
          SELECT c.id FROM notification.channel c
           WHERE c.account_id = ${accountId}
             AND EXISTS (SELECT FROM notification.message WHERE id = ${messageId})
             AND NOT EXISTS (
               SELECT FROM notification.delivery d
                WHERE d.message_id = ${messageId} AND d.channel_id = c.id)
           ORDER BY c.kind <> 'email', c.created_at, c.id`);
        return result.rows.map(({ id }) => id);
      }),

    async deliver(accountId, messageId, channelId) {
      const [pending] = (
        await asAccount(accountId, (tx) =>
          tx.execute<PendingRow>(sql`
            SELECT m.code, m.details, m.created_at, c.kind, c.endpoint, c.p256dh, c.auth_secret
              FROM notification.message m
              JOIN notification.channel c ON c.id = ${channelId} AND c.account_id = m.account_id
             WHERE m.id = ${messageId}
               AND NOT EXISTS (
                 SELECT FROM notification.delivery d
                  WHERE d.message_id = m.id AND d.channel_id = c.id)`),
        )
      ).rows;
      if (pending === undefined) return;
      if (pending.kind === 'email') {
        const to = await accounts.emailOf(authDb, accountId);
        if (to === undefined) return;
        await notices.send(noticeOf(pending, to, new Date(pending.created_at)));
      } else {
        if (push === undefined) return;
        const { endpoint, p256dh, auth_secret: authSecret } = pending;
        if (endpoint === null || p256dh === null || authSecret === null) return;
        const payload = { code: checkedCode(pending), id: messageId };
        const outcome = await push
          .send({ endpoint, p256dh, authSecret }, payload)
          .catch((error: unknown) => {
            throw new PushFailedError('push failed', { cause: error });
          });
        if (outcome === 'gone') {
          // Counted, so a refusal of our own making (a broken key) shows before every channel goes.
          logger.error({ errorName: 'notification_push_gone' });
          await asAccount(accountId, (tx) =>
            tx.execute(sql`DELETE FROM notification.channel WHERE id = ${channelId}`),
          );
          return;
        }
      }
      // A send whose record fails is sent again on the retry: at least once, never lost.
      await asAccount(accountId, async (tx) => {
        await tx.execute(sql`
          INSERT INTO notification.delivery (account_id, message_id, channel_id)
          VALUES (${accountId}, ${messageId}, ${channelId})
          ON CONFLICT DO NOTHING`);
        await tx.execute(sql`
          UPDATE notification.channel SET last_success_at = now() WHERE id = ${channelId}`);
      });
    },
  };
}

/**
 * Runs every step in one call, for the inactivity warning, which must reach the email channel
 * before its account is marked. A push that fails is logged and left undelivered: the email is
 * the guarantee (spec 0004, R10), and a push service must never hold back an erasure.
 */
export async function deliverNow(
  delivery: Delivery,
  accountId: string,
  messageId: string,
  logger: Logger,
): Promise<void> {
  const channels = await delivery.pendingChannels(accountId, messageId);
  // Side by side, so slow push services cost the job one timeout, not one per channel.
  const outcomes = await Promise.allSettled(
    channels.map((channelId) => delivery.deliver(accountId, messageId, channelId)),
  );
  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') continue;
    const error: unknown = outcome.reason;
    if (!(error instanceof PushFailedError)) throw error;
    const cause = error.cause instanceof Error ? error.cause.name : 'NonErrorThrown';
    logger.error({ errorName: `notification_push_failed:${cause}` });
  }
}
