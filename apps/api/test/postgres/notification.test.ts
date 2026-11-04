import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Notice, Notices } from '../../src/email/notices.js';
import { createDelivery, deliverNow, type Delivery } from '../../src/notification/delivery.js';
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
