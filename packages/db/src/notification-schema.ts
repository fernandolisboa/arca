import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgPolicy,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Notifications (spec 0005, R7): where an account is told things, what it was told and which
 * channel has it. Every row belongs to one account and is reachable only under that account's
 * identity: `app_api` adds push channels and messages for requests; `app_jobs` adds messages
 * for the daily jobs and the email channel, delivers, records the delivery, drops a channel the
 * push service reports gone, and erases. Messages hold a code and
 * identifiers, never text. No foreign key reaches the auth schema; erasure goes through the
 * registry.
 */
export const notification = pgSchema('notification');

const ownRow = (accountId: unknown): SQL =>
  sql`${accountId} = nullif(current_setting('app.account_id', true), '')::uuid`;

type Command = 'select' | 'insert' | 'update' | 'delete';

/** One policy per command and role, each holding only under the row owner's identity. */
function ownRowPolicies(
  table: string,
  accountId: unknown,
  commands: { readonly app_api: readonly Command[]; readonly app_jobs: readonly Command[] },
) {
  const own = ownRow(accountId);
  return Object.entries(commands).flatMap(([role, list]) =>
    list.map((command) =>
      pgPolicy(`${table}_${command}_own${role === 'app_jobs' ? '_by_jobs' : ''}`, {
        for: command,
        to: role,
        ...(command === 'insert' ? { withCheck: own } : { using: own }),
        ...(command === 'update' ? { withCheck: own } : {}),
      }),
    ),
  );
}

/**
 * Where an account's notifications go: its email address (one channel, the address itself stays
 * in auth) or a browser's push subscription. A push channel the push service reports gone is
 * deleted.
 */
export const channel = notification.table(
  'channel',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull(),
    kind: text('kind').notNull(),
    /** The push service URL of a `web_push` subscription; null for `email`. */
    endpoint: text('endpoint'),
    /** The subscription's P-256 public key and auth secret, base64url; null for `email`. */
    p256dh: text('p256dh'),
    authSecret: text('auth_secret'),
    /** The browser and system families that subscribed, as spec 0003 R7 names them. */
    browser: text('browser'),
    os: text('os'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'channel_fields_by_kind',
      sql`(${table.kind} = 'web_push' AND ${table.endpoint} IS NOT NULL AND ${table.p256dh} IS NOT NULL
            AND ${table.authSecret} IS NOT NULL AND ${table.browser} IS NOT NULL AND ${table.os} IS NOT NULL)
        OR (${table.kind} = 'email' AND ${table.endpoint} IS NULL AND ${table.p256dh} IS NULL
            AND ${table.authSecret} IS NULL AND ${table.browser} IS NULL AND ${table.os} IS NULL)`,
    ),
    check(
      'channel_endpoint_https',
      sql`${table.endpoint} ~ '^https://' AND char_length(${table.endpoint}) <= 2048`,
    ),
    check('channel_p256dh_format', sql`${table.p256dh} ~ '^[A-Za-z0-9_-]{87}$'`),
    check('channel_auth_secret_format', sql`${table.authSecret} ~ '^[A-Za-z0-9_-]{22}$'`),
    check(
      'channel_device_format',
      sql`${table.browser} ~ '^[a-z_]{1,32}$' AND ${table.os} ~ '^[a-z_]{1,32}$'`,
    ),
    unique('channel_id_account_id_key').on(table.id, table.accountId),
    uniqueIndex('channel_email_idx')
      .on(table.accountId)
      .where(sql`${table.kind} = 'email'`),
    uniqueIndex('channel_endpoint_idx').on(table.accountId, table.endpoint),
    ...ownRowPolicies('channel', table.accountId, {
      app_api: ['select', 'insert', 'delete'],
      app_jobs: ['select', 'insert', 'update', 'delete'],
    }),
  ],
);

/** Something an account was told: a code and identifiers only; the device or email words it. */
export const message = notification.table(
  'message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull(),
    code: text('code').notNull(),
    /** The entity the message is about, when it has one. */
    entityId: uuid('entity_id'),
    /** Enum values and times only, by a closed per-code list in the API. */
    details: jsonb('details').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('message_code_format', sql`${table.code} ~ '^[a-z_]{1,64}$'`),
    check('message_details_object', sql`jsonb_typeof(${table.details}) = 'object'`),
    check('message_details_size', sql`octet_length(${table.details}::text) <= 1024`),
    unique('message_id_account_id_key').on(table.id, table.accountId),
    index('message_account_created_idx').on(table.accountId, table.createdAt),
    ...ownRowPolicies('message', table.accountId, {
      app_api: ['select', 'insert'],
      app_jobs: ['select', 'insert', 'delete'],
    }),
  ],
);

/** A message delivered on a channel, so a retried delivery skips the channels already reached. */
export const delivery = notification.table(
  'delivery',
  {
    accountId: uuid('account_id').notNull(),
    messageId: uuid('message_id').notNull(),
    channelId: uuid('channel_id').notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.channelId] }),
    foreignKey({
      name: 'delivery_message_fkey',
      columns: [table.messageId, table.accountId],
      foreignColumns: [message.id, message.accountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'delivery_channel_fkey',
      columns: [table.channelId, table.accountId],
      foreignColumns: [channel.id, channel.accountId],
    }).onDelete('cascade'),
    index('delivery_channel_idx').on(table.channelId),
    ...ownRowPolicies('delivery', table.accountId, {
      app_api: ['select'],
      app_jobs: ['select', 'insert', 'delete'],
    }),
  ],
);
