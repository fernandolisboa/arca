import { sql } from 'drizzle-orm';
import { index, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auth, createdAt, passkey } from './auth-schema.js';

// Arca's own tables in the auth schema, kept apart from Better Auth's so the modules that send
// notices never hold a binding to the credential tables, which only src/auth/auth.ts may import
// (spec 0003, R1). Only app_auth may touch them.

/**
 * The browser and system families each passkey has signed in from, so a sign-in from a new one
 * sends a notice (spec 0003, R7). Deleted with its passkey.
 */
export const passkeyClient = auth.table(
  'passkey_client',
  {
    credentialID: text('credential_id')
      .notNull()
      .references(() => passkey.credentialID, { onDelete: 'cascade' }),
    browser: text('browser').notNull(),
    os: text('os').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.credentialID, table.browser, table.os] })],
);

/**
 * Messages the outbox adapter "sends" outside production (spec 0003, R8). Present in every
 * environment so schemas never diverge; production refuses the adapter. Rows expire after 7 days.
 */
export const outbox = auth.table(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '7 days'`),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
  },
  (table) => [index('outbox_created_at_idx').on(table.createdAt)],
);
