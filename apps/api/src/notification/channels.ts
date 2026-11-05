import { timingSafeEqual } from 'node:crypto';
import {
  maxPushChannels,
  type AddPushChannelRequest,
  type DeviceDescription,
  type ForgetPushChannelRequest,
  type NotificationChannel,
} from '@arca/api-contract/routes';
import { withIdentity, type Database } from '@arca/db';
import { sql } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';

/** The account's own notification channels, on app_api under its identity (spec 0005, R7). */
export interface NotificationChannels {
  list(accountId: string): Promise<NotificationChannel[]>;
  /** The channel of this subscription, added unless the account has it already. */
  addPush(
    accountId: string,
    subscription: AddPushChannelRequest,
    device: DeviceDescription,
  ): Promise<AddPushOutcome>;
  /** False for an unknown channel or the email channel, which every account keeps. */
  removePush(accountId: string, channelId: string): Promise<boolean>;
  /** The channel of this subscription, removed only when its auth secret matches; false if none. */
  forgetPush(accountId: string, subscription: ForgetPushChannelRequest): Promise<boolean>;
}

/** `too_many`: the account already has `maxPushChannels` other push channels. */
export type AddPushOutcome = { readonly channelId: string } | 'too_many';

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
  const added = (accountId: string, channelId: string) =>
    audit.record({
      code: 'notification_channel_added',
      subjectAccountId: accountId,
      actorAccountId: accountId,
      details: { channelId },
    });
  const removed = (
    accountId: string,
    channelId: string,
    reason: 'step_up' | 'renewed' | 'subscription',
  ) =>
    audit.record({
      code: 'notification_channel_removed',
      subjectAccountId: accountId,
      actorAccountId: accountId,
      details: { channelId, reason },
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

    addPush: (accountId, { endpoint, p256dh, auth }, device) =>
      withIdentity(db, { accountId }, async (tx) => {
        // A browser that renewed its keys for the same endpoint replaces its channel.
        const replaced = await tx.execute<{ id: string }>(sql`
          DELETE FROM notification.channel
           WHERE account_id = ${accountId} AND endpoint = ${endpoint}
             AND (p256dh <> ${p256dh} OR auth_secret <> ${auth})
          RETURNING id`);
        for (const { id } of replaced.rows) await removed(accountId, id, 'renewed');
        const existing = await tx.execute<{ id: string }>(sql`
          SELECT id FROM notification.channel
           WHERE account_id = ${accountId} AND endpoint = ${endpoint}`);
        const [found] = existing.rows;
        if (found !== undefined) return { channelId: found.id };
        const others = await tx.execute<{ total: number }>(sql`
          SELECT count(*)::int AS total FROM notification.channel
           WHERE account_id = ${accountId} AND kind = 'web_push'`);
        if ((others.rows[0]?.total ?? 0) >= maxPushChannels) return 'too_many';
        const inserted = await tx.execute<{ id: string }>(sql`
          INSERT INTO notification.channel
                 (account_id, kind, endpoint, p256dh, auth_secret, browser, os)
          VALUES (${accountId}, 'web_push', ${endpoint}, ${p256dh}, ${auth},
                  ${device.browser}, ${device.os})
          ON CONFLICT (account_id, endpoint) DO NOTHING
          RETURNING id`);
        const [stored] = inserted.rows;
        if (stored !== undefined) {
          await added(accountId, stored.id);
          return { channelId: stored.id };
        }
        // A concurrent request added the same endpoint first.
        const raced = await tx.execute<{ id: string }>(sql`
          SELECT id FROM notification.channel
           WHERE account_id = ${accountId} AND endpoint = ${endpoint}`);
        const [winner] = raced.rows;
        if (winner === undefined) throw new Error('push channel neither added nor found');
        return { channelId: winner.id };
      }),

    removePush: (accountId, channelId) =>
      withIdentity(db, { accountId }, async (tx) => {
        const deleted = await tx.execute<{ id: string }>(sql`
          DELETE FROM notification.channel
           WHERE id = ${channelId} AND account_id = ${accountId} AND kind = 'web_push'
          RETURNING id`);
        if (deleted.rows.length === 0) return false;
        await removed(accountId, channelId, 'step_up');
        return true;
      }),

    forgetPush: (accountId, { endpoint, auth }) =>
      withIdentity(db, { accountId }, async (tx) => {
        const found = await tx.execute<{ id: string; auth_secret: string }>(sql`
          SELECT id, auth_secret FROM notification.channel
           WHERE account_id = ${accountId} AND kind = 'web_push' AND endpoint = ${endpoint}`);
        const [channel] = found.rows;
        // Compared in constant time: the secret is what proves the browser holds the subscription.
        const given = Buffer.from(auth);
        const stored = Buffer.from(channel?.auth_secret ?? '');
        if (channel === undefined || stored.length !== given.length) return false;
        if (!timingSafeEqual(stored, given)) return false;
        const deleted = await tx.execute<{ id: string }>(
          sql`DELETE FROM notification.channel WHERE id = ${channel.id} RETURNING id`,
        );
        if (deleted.rows.length === 0) return false;
        await removed(accountId, channel.id, 'subscription');
        return true;
      }),
  };
}
