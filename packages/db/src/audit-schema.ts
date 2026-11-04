import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The append-only audit log (spec 0003, R7). Only `app_audit` inserts, and it has no privilege on
 * `time` or `id`, so the database sets both. No runtime role may update or delete, and with no
 * update or delete policy under forced row-level security even the owner's UPDATE and DELETE match
 * no row (TRUNCATE and DROP stay the owner's, through reviewed migrations); the retention purge
 * (spec 0004) will need its own policy. An account reads, through `app_api`,
 * the events whose subject it is. No foreign keys leave this schema, so
 * erasing an account never touches its audit trail (spec 0004).
 */
export const audit = pgSchema('audit');

export const event = audit.table(
  'event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    time: timestamp('time', { withTimezone: true }).notNull().defaultNow(),
    actorAccountId: uuid('actor_account_id'),
    subjectAccountId: uuid('subject_account_id').notNull(),
    code: text('code').notNull(),
    requestId: text('request_id'),
    /** Identifiers and enum values only, by a closed per-code list in the API contract. */
    details: jsonb('details').notNull().default({}),
  },
  (table) => [
    check('event_code_format', sql`${table.code} ~ '^[a-z_]{1,64}$'`),
    check('event_details_object', sql`jsonb_typeof(${table.details}) = 'object'`),
    index('event_subject_time_idx').on(table.subjectAccountId, table.time.desc(), table.id.desc()),
    pgPolicy('event_insert_by_audit', { for: 'insert', to: 'app_audit', withCheck: sql`true` }),
    pgPolicy('event_read_own', {
      for: 'select',
      to: 'app_api',
      using: sql`${table.subjectAccountId} = nullif(current_setting('app.account_id', true), '')::uuid`,
    }),
  ],
);
