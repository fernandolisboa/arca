import { sql } from 'drizzle-orm';
import { bytea, check, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auth, session, user } from './auth-schema.js';

/** The step-up purposes the database accepts; the contract's closed enum (spec 0003, R5). */
const purposeCheck = (column: unknown) =>
  sql`${column} IN ('sensitive_settings', 'account_deletion', 'data_export', 'financial_action', 'vault_unlock', 'vault_write')`;

/** `vault_unlock` alone carries no subject; every other purpose carries a 32-byte one. */
const subjectCheck = (purpose: unknown, subject: unknown) =>
  sql`(${purpose} = 'vault_unlock') = (octet_length(${subject}) = 0) AND octet_length(${subject}) IN (0, 32)`;

/**
 * Open step-up challenges (spec 0003, R5): bound to the session and account that asked, single use
 * (deleted when verified) and valid for 2 minutes. Only app_auth touches it; never backed up.
 */
export const stepUpChallenge = auth.table(
  'step_up_challenge',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    /** Empty for `vault_unlock`, otherwise the SHA-256 of the canonical action. */
    subjectHash: bytea('subject_hash').notNull(),
    nonce: bytea('nonce').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '2 minutes'`),
  },
  (table) => [
    index('step_up_challenge_expires_at_idx').on(table.expiresAt),
    check('step_up_challenge_purpose', purposeCheck(table.purpose)),
    check('step_up_challenge_subject', subjectCheck(table.purpose, table.subjectHash)),
    check('step_up_challenge_nonce_length', sql`octet_length(${table.nonce}) = 32`),
  ],
);

/**
 * Verified step-up assertions, kept so a consumer can verify one again later (spec 0003, R5).
 * The session and credential are plain values, not references: the record outlives both, and is
 * erased with the account.
 */
export const stepUp = auth.table(
  'step_up',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull(),
    credentialId: text('credential_id').notNull(),
    purpose: text('purpose').notNull(),
    subjectHash: bytea('subject_hash').notNull(),
    nonce: bytea('nonce').notNull(),
    authenticatorData: bytea('authenticator_data').notNull(),
    clientDataJson: bytea('client_data_json').notNull(),
    signature: bytea('signature').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when an action spends it; `vault_unlock` step-ups are never consumed. */
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [
    index('step_up_session_purpose_idx').on(table.sessionId, table.purpose, table.verifiedAt),
    index('step_up_account_id_idx').on(table.accountId),
    // For the sweep of step-ups never spent.
    index('step_up_unspent_idx')
      .on(table.verifiedAt)
      .where(sql`${table.consumedAt} IS NULL`),
    check('step_up_purpose', purposeCheck(table.purpose)),
    check('step_up_subject', subjectCheck(table.purpose, table.subjectHash)),
    check('step_up_nonce_length', sql`octet_length(${table.nonce}) = 32`),
  ],
);
