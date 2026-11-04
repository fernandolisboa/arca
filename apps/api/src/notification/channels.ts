import type { AddPushChannelRequest, NotificationChannel } from '@arca/api-contract/routes';
import { withIdentity, type Database } from '@arca/db';
import { sql } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';

/** The account's own notification channels, on app_api under its identity (spec 0005, R7). */
export interface NotificationChannels {
  list(accountId: string): Promise<NotificationChannel[]>;
  /** The channel of this subscription, added unless the account has it already. */
  addPush(accountId: string, subscription: AddPushChannelRequest): Promise<string>;
  /** False for an unknown channel or the email channel, which every account keeps. */
  removePush(accountId: string, channelId: string): Promise<boolean>;
}

interface ChannelRow {
  id: string;
  kind: 'email' | 'web_push';
  browser: NotificationChannel['browser'];
  os: NotificationChannel['os'];
  created_at: Date;
  last_success_at: Date | null;
}

export function createNotificationChannels({
  db,
  audit,
}: {
  /** The app_api pool. */
  readonly db: Database;
  readonly audit: AuditLog;
}): NotificationChannels {
  const record = (
    accountId: string,
    code: 'notification_channel_added' | 'notification_channel_removed',
    channelId: string,
  ) =>
    audit.record({
      code,
      subjectAccountId: accountId,
      actorAccountId: accountId,
      details: { channelId },
    });

  return {
    list: (accountId) =>
      withIdentity(db, { accountId }, async (tx) => {
        const result = await tx.execute<ChannelRow>(sql`
          SELECT id, kind, browser, os, created_at, last_success_at
            FROM notification.channel
           WHERE account_id = ${accountId}
           ORDER BY created_at, id`);
        return result.rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          browser: row.browser,
          os: row.os,
          createdAt: new Date(row.created_at).toISOString(),
          lastSuccessAt:
            row.last_success_at === null ? null : new Date(row.last_success_at).toISOString(),
        }));
      }),

    addPush: (accountId, { endpoint, p256dh, auth, device }) =>
      withIdentity(db, { accountId }, async (tx) => {
        // A browser that renewed its keys for the same endpoint replaces its channel.
        await tx.execute(sql`
          DELETE FROM notification.channel
           WHERE account_id = ${accountId} AND endpoint = ${endpoint}
             AND (p256dh <> ${p256dh} OR auth_secret <> ${auth})`);
        const added = await tx.execute<{ id: string }>(sql`
          INSERT INTO notification.channel
                 (account_id, kind, endpoint, p256dh, auth_secret, browser, os)
          VALUES (${accountId}, 'web_push', ${endpoint}, ${p256dh}, ${auth},
                  ${device.browser}, ${device.os})
          ON CONFLICT (account_id, endpoint) DO NOTHING
          RETURNING id`);
        const [inserted] = added.rows;
        if (inserted !== undefined) {
          await record(accountId, 'notification_channel_added', inserted.id);
          return inserted.id;
        }
        const existing = await tx.execute<{ id: string }>(sql`
          SELECT id FROM notification.channel
           WHERE account_id = ${accountId} AND endpoint = ${endpoint}`);
        const [found] = existing.rows;
        if (found === undefined) throw new Error('push channel neither added nor found');
        return found.id;
      }),

    removePush: (accountId, channelId) =>
      withIdentity(db, { accountId }, async (tx) => {
        const removed = await tx.execute<{ id: string }>(sql`
          DELETE FROM notification.channel
           WHERE id = ${channelId} AND account_id = ${accountId} AND kind = 'web_push'
          RETURNING id`);
        if (removed.rows.length === 0) return false;
        await record(accountId, 'notification_channel_removed', channelId);
        return true;
      }),
  };
}
