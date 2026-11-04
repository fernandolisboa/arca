import { sql } from 'drizzle-orm';
import { bytea, boolean, check, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auth, passkey, user } from './auth-schema.js';

/**
 * Enrollment codes already spent (spec 0003, R2). The primary key makes two concurrent
 * enrollments conflict, and the rows are never erased, so an emptied user table never revives a
 * used code. Holds no personal data; backed up.
 */
export const setup = auth.table('setup', {
  codeHash: bytea('code_hash').primaryKey(),
  usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Contexts for passkey-first registration (spec 0003, R2): the link token is 256 random bits and
 * only its SHA-256 hash is stored; deleted when a registration spends it, so it is single use and
 * its address goes with it. Never backed up.
 */
export const registrationContext = auth.table(
  'registration_context',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: bytea('token_hash').notNull().unique(),
    kind: text('kind').notNull(),
    email: text('email').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 minutes'`),
  },
  (table) => [
    index('registration_context_expires_at_idx').on(table.expiresAt),
    check('registration_context_kind', sql`${table.kind} IN ('owner')`),
    check('registration_context_token_length', sql`octet_length(${table.tokenHash}) = 32`),
  ],
);

/**
 * The account part of the recovery kit (spec 0003, R6): SHA-256 over a per-account 128-bit salt
 * and the code; the code itself is shown once and never stored. Erased with the account.
 */
export const recoveryCode = auth.table(
  'recovery_code',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    salt: bytea('salt').notNull(),
    codeHash: bytea('code_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the person confirms the kit was saved; it is never shown again. */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (table) => [
    check('recovery_code_salt_length', sql`octet_length(${table.salt}) = 16`),
    check('recovery_code_hash_length', sql`octet_length(${table.codeHash}) = 32`),
  ],
);

/** What a passkey's authenticator reported at registration (spec 0003, R3). Deleted with it. */
export const passkeyCapability = auth.table('passkey_capability', {
  credentialID: text('credential_id')
    .primaryKey()
    .references(() => passkey.credentialID, { onDelete: 'cascade' }),
  /** Whether the authenticator reported the PRF extension enabled (ADR-0018). */
  prfEnabled: boolean('prf_enabled').notNull(),
});

/**
 * Invites (spec 0003, R2): the link token is 256 random bits and only its SHA-256 hash is stored;
 * single use through `accepted_at`, expiring after 48 hours. An accepted invite stays until the
 * inviter confirms or declines the new account; erasing either account erases the invite with
 * the invitee's address. Never backed up.
 */
export const invite = auth.table(
  'invite',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '48 hours'`),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedAccountId: uuid('accepted_account_id')
      .unique()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('invite_inviter_id_idx').on(table.inviterId),
    index('invite_expires_at_idx').on(table.expiresAt),
    check('invite_token_length', sql`octet_length(${table.tokenHash}) = 32`),
    check(
      'invite_accepted_together',
      sql`(${table.acceptedAt} IS NULL) = (${table.acceptedAccountId} IS NULL)`,
    ),
  ],
);
