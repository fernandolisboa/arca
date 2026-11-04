import { index, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { auth } from './auth-schema.js';

/**
 * Fixed-window request counters for the auth routes (spec 0003, R10). The key names the limit and
 * an HMAC of what it counts (an IP address, an email address, an account), never the value
 * itself; the HMAC key lives only in the environment. Only app_auth touches it; never backed up.
 */
export const rateLimit = auth.table(
  'rate_limit',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('rate_limit_expires_at_idx').on(table.expiresAt)],
);
