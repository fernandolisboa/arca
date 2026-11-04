import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Notice, Notices } from '../../src/email/notices.js';
import { auditLog } from '../../src/audit/log.js';
import {
  createNotificationChannels,
  type NotificationChannels,
} from '../../src/notification/channels.js';
import { createDelivery, deliverNow, type Delivery } from '../../src/notification/delivery.js';
import type { PushOutcome, PushPayload, PushSender } from '../../src/notification/push.js';
import { createNotifier, type Notifier } from '../../src/notification/notifier.js';
import { authTestDatabase, type AuthTestDatabase } from './auth-database.js';

// Notifications from producer to email on the real migrations, through app_api and app_jobs
// (spec 0005, R7). Synthetic data only.
let testDatabase: AuthTestDatabase;
let delivery: Delivery;
let notifier: Notifier;
let sent: Notice[];
let failing: boolean;
let started: { accountId: string; messageId: string }[];

const notices: Notices = {
  send: (notice) => {
    if (failing) return Promise.reject(new Error('email unavailable'));
    sent.push(notice);
    return Promise.resolve();
  },
};

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  delivery = createDelivery({ jobsDb: testDatabase.jobsDb, authDb: testDatabase.authDb, notices });
  notifier = createNotifier({
    db: testDatabase.apiDb,
    startDelivery: (accountId, messageId) => {
      started.push({ accountId, messageId });
      return Promise.resolve();
    },
  });
});

beforeEach(() => {
  sent = [];
  failing = false;
  started = [];
});

afterAll(async () => {
  await testDatabase.drop();
});

const admin = async <Row extends object>(statement: string, values: unknown[] = []) =>
  (await testDatabase.asAdmin((client) => client.query<Row>(statement, values))).rows;

async function account() {
  const accountId = randomUUID();
  const email = `${accountId}@example.com`;
  await admin(`INSERT INTO auth.user (id, name, email) VALUES ($1, '', $2)`, [accountId, email]);
  return { accountId, email };
}

/** Notifies the account and returns the message its delivery was started with. */
async function notified(accountId: string, notification: Parameters<Notifier['notify']>[1]) {
  await notifier.notify(accountId, notification);
  const run = started.at(-1);
  if (run?.accountId !== accountId) throw new Error('no delivery started');
  return run.messageId;
}

const channelsOf = (accountId: string) =>
  admin<{ kind: string; lastSuccess: Date | null }>(
    `SELECT kind, last_success_at AS "lastSuccess" FROM notification.channel WHERE account_id = $1`,
    [accountId],
  );

const deliveriesOf = (messageId: string) =>
  admin(`SELECT channel_id FROM notification.delivery WHERE message_id = $1`, [messageId]);

describe('notifications (spec 0005, R7)', () => {
  it('records the code and details under the identity and starts the delivery with identifiers', async () => {
    const { accountId } = await account();
    const messageId = await notified(accountId, {
      kind: 'new_sign_in',
      device: { browser: 'chrome', os: 'android' },
    });
    expect(
      await admin(
        `SELECT account_id, code, entity_id, details FROM notification.message WHERE id = $1`,
        [messageId],
      ),
    ).toEqual([
      {
        account_id: accountId,
        code: 'new_sign_in',
        entity_id: null,
        details: { browser: 'chrome', os: 'android' },
      },
    ]);
    expect(started).toEqual([{ accountId, messageId }]);
  });

  it('emails the notice once, on the email channel it creates, and records the delivery', async () => {
    const { accountId, email } = await account();
    const dueAt = new Date('2027-01-03T15:30:00Z');
    const messageId = await notified(accountId, { kind: 'inactivity_warning', dueAt });
    const [created] = await admin<{ at: Date }>(
      `SELECT created_at AS at FROM notification.message WHERE id = $1`,
      [messageId],
    );

    await deliverNow(delivery, accountId, messageId);

    expect(sent).toEqual([{ kind: 'inactivity_warning', to: email, at: created?.at, dueAt }]);
    const [channel] = await channelsOf(accountId);
    expect(channel?.kind).toBe('email');
    expect(channel?.lastSuccess).toBeInstanceOf(Date);
    expect(await channelsOf(accountId)).toHaveLength(1);
    expect(await deliveriesOf(messageId)).toHaveLength(1);

    // A second run, as a retried workflow: nothing left to reach, nothing sent again.
    expect(await delivery.pendingChannels(accountId, messageId)).toEqual([]);
    await deliverNow(delivery, accountId, messageId);
    expect(sent).toHaveLength(1);

    // The next message reuses the one email channel.
    await deliverNow(delivery, accountId, await notified(accountId, { kind: 'passkey_added' }));
    expect(sent.map(({ kind }) => kind)).toEqual(['inactivity_warning', 'passkey_added']);
    expect(await channelsOf(accountId)).toHaveLength(1);
  });

  it('records no delivery when the email fails, so the retry sends it', async () => {
    const { accountId } = await account();
    const messageId = await notified(accountId, { kind: 'sessions_revoked' });
    failing = true;
    await expect(deliverNow(delivery, accountId, messageId)).rejects.toThrow('email unavailable');
    expect(await deliveriesOf(messageId)).toEqual([]);
    failing = false;
    await deliverNow(delivery, accountId, messageId);
    expect(sent.map(({ kind }) => kind)).toEqual(['sessions_revoked']);
    expect(await deliveriesOf(messageId)).toHaveLength(1);
  });

  it("delivers nothing of another account's message, and creates it no channel", async () => {
    const owner = await account();
    const other = await account();
    const messageId = await notified(owner.accountId, { kind: 'recovery_started' });
    expect(await delivery.pendingChannels(other.accountId, messageId)).toEqual([]);
    await deliverNow(delivery, owner.accountId, messageId);
    const [channel] = await admin<{ id: string }>(
      `SELECT id FROM notification.channel WHERE account_id = $1`,
      [owner.accountId],
    );
    await delivery.deliver(other.accountId, messageId, channel?.id ?? '');
    expect(sent).toHaveLength(1);
    expect(await channelsOf(other.accountId)).toEqual([]);
  });

  it('gives a message whose account was erased no channel and no email', async () => {
    const { accountId } = await account();
    const messageId = await notified(accountId, { kind: 'deletion_requested' });
    await admin(`DELETE FROM notification.message WHERE id = $1`, [messageId]);
    await deliverNow(delivery, accountId, messageId);
    expect(sent).toEqual([]);
    expect(await channelsOf(accountId)).toEqual([]);
  });

  it('refuses an account ID that is not a UUID, before any SQL', async () => {
    await expect(notifier.notify('not-a-uuid', { kind: 'passkey_added' })).rejects.toThrow();
    expect(started).toEqual([]);
  });
});

const subscription = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/synthetic-${String(n)}`,
  p256dh: `B${'C'.repeat(86)}`,
  auth: 'D'.repeat(22),
  device: { browser: 'chrome' as const, os: 'android' as const },
});

const auditOf = (accountId: string) =>
  admin<{ code: string; details: object }>(
    `SELECT code, details FROM audit.event WHERE subject_account_id = $1 ORDER BY time`,
    [accountId],
  );

describe('push channels (spec 0005, R7)', () => {
  let channels: NotificationChannels;
  beforeAll(() => {
    channels = createNotificationChannels({
      db: testDatabase.apiDb,
      audit: auditLog(testDatabase.auditDb),
    });
  });

  it('adds a subscription once, as app_api under the identity, and audits it', async () => {
    const { accountId } = await account();
    const channelId = await channels.addPush(accountId, subscription(1));
    expect(await channels.addPush(accountId, subscription(1))).toBe(channelId);
    expect(await channels.list(accountId)).toEqual([
      {
        id: channelId,
        kind: 'web_push',
        browser: 'chrome',
        os: 'android',
        createdAt: expect.any(String) as string,
        lastSuccessAt: null,
      },
    ]);
    expect(await auditOf(accountId)).toEqual([
      { code: 'notification_channel_added', details: { channelId } },
    ]);
  });

  it('replaces the channel of an endpoint whose keys were renewed', async () => {
    const { accountId } = await account();
    const first = await channels.addPush(accountId, subscription(2));
    const renewed = await channels.addPush(accountId, { ...subscription(2), auth: 'E'.repeat(22) });
    expect(renewed).not.toBe(first);
    expect((await channels.list(accountId)).map(({ id }) => id)).toEqual([renewed]);
  });

  it("removes the account's push channel with its deliveries, never the email channel or another's", async () => {
    const owner = await account();
    const other = await account();
    const channelId = await channels.addPush(owner.accountId, subscription(3));
    const messageId = await notified(owner.accountId, { kind: 'passkey_added' });
    await deliverNow(
      createDelivery({ ...pools(), push: answering('delivered') }),
      owner.accountId,
      messageId,
    );
    const [email] = (await channels.list(owner.accountId)).filter(({ kind }) => kind === 'email');

    expect(await channels.removePush(other.accountId, channelId)).toBe(false);
    expect(await channels.removePush(owner.accountId, email?.id ?? '')).toBe(false);
    expect(await channels.removePush(owner.accountId, channelId)).toBe(true);

    expect((await channels.list(owner.accountId)).map(({ kind }) => kind)).toEqual(['email']);
    expect(await deliveriesOf(messageId)).toEqual([{ channel_id: email?.id }]);
    expect((await auditOf(owner.accountId)).map(({ code }) => code)).toEqual([
      'notification_channel_added',
      'notification_channel_removed',
    ]);
  });
});

const pools = () => ({ jobsDb: testDatabase.jobsDb, authDb: testDatabase.authDb, notices });

function answering(outcome: PushOutcome) {
  const pushed: PushPayload[] = [];
  const sender: PushSender & { pushed: PushPayload[] } = {
    pushed,
    send: (_subscription, payload) => {
      pushed.push(payload);
      return Promise.resolve(outcome);
    },
  };
  return sender;
}

describe('push delivery (spec 0005, R7)', () => {
  const pushChannel = async (accountId: string, n: number) =>
    createNotificationChannels({
      db: testDatabase.apiDb,
      audit: auditLog(testDatabase.auditDb),
    }).addPush(accountId, subscription(n));

  it('pushes the code and the message ID, and email gets its notice too', async () => {
    const { accountId } = await account();
    const channelId = await pushChannel(accountId, 10);
    const messageId = await notified(accountId, { kind: 'recovery_completed' });
    const push = answering('delivered');
    await deliverNow(createDelivery({ ...pools(), push }), accountId, messageId);
    expect(push.pushed).toEqual([{ code: 'recovery_completed', id: messageId }]);
    expect(sent.map(({ kind }) => kind)).toEqual(['recovery_completed']);
    expect(await deliveriesOf(messageId)).toHaveLength(2);
    const [channel] = await admin<{ last: Date | null }>(
      `SELECT last_success_at AS last FROM notification.channel WHERE id = $1`,
      [channelId],
    );
    expect(channel?.last).toBeInstanceOf(Date);
  });

  it('deletes a channel the push service reports gone, recording nothing for it', async () => {
    const { accountId } = await account();
    const channelId = await pushChannel(accountId, 11);
    const messageId = await notified(accountId, { kind: 'passkey_revoked' });
    await deliverNow(createDelivery({ ...pools(), push: answering('gone') }), accountId, messageId);
    expect(await admin(`SELECT FROM notification.channel WHERE id = $1`, [channelId])).toEqual([]);
    expect(await deliveriesOf(messageId)).toHaveLength(1);
  });

  it('leaves push channels pending where the environment has no VAPID key', async () => {
    const { accountId } = await account();
    const channelId = await pushChannel(accountId, 12);
    const messageId = await notified(accountId, { kind: 'passkey_revoked' });
    await deliverNow(createDelivery(pools()), accountId, messageId);
    expect(await delivery.pendingChannels(accountId, messageId)).toEqual([channelId]);
  });
});
