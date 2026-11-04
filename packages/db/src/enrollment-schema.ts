import { sql } from 'drizzle-orm';
import { bytea, boolean, check, index, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auth, passkey, session, user } from './auth-schema.js';

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
    /**
     * Set on a code a recovery issued, to the end of its link (spec 0003, R6): past it, the code
     * counts as no code unless the recovery registered its passkey, which clears it.
     */
    provisionalUntil: timestamp('provisional_until', { withTimezone: true }),
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
 * A passkey added to an account that already had one (spec 0003, R4): it can neither sign in nor
 * approve a step-up before `active_from`, 24 hours after it was added. A passkey without a row is
 * active; the row is written in the transaction that stores the passkey, and goes with it, so
 * cancelling a pending passkey is revoking it.
 */
export const passkeyActivation = auth.table(
  'passkey_activation',
  {
    credentialID: text('credential_id')
      .primaryKey()
      .references(() => passkey.credentialID, { onDelete: 'cascade' }),
    activeFrom: timestamp('active_from', { withTimezone: true }).notNull(),
    /** Registered by a recovery (spec 0003, R6): until it activates, every session is restricted. */
    recovery: boolean('recovery').notNull().default(false),
  },
  (table) => [index('passkey_activation_active_from_idx').on(table.activeFrom)],
);

/**
 * Open challenges for adding a passkey from a signed-in session (spec 0003, R4): bound to the
 * session and account that asked, single use (deleted when verified) and valid for 2 minutes.
 */
export const passkeyChallenge = auth.table(
  'passkey_challenge',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    challenge: bytea('challenge').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '2 minutes'`),
  },
  (table) => [
    index('passkey_challenge_expires_at_idx').on(table.expiresAt),
    check('passkey_challenge_length', sql`octet_length(${table.challenge}) = 32`),
  ],
);

/**
 * Recovery links (spec 0003, R6): the token is 256 random bits and only its SHA-256 hash is
 * stored; one per account, valid for `recoveryLinkMinutes` (the insert sets it; the default only
 * matches it). Accepting the recovery code marks it redeemed and replaces the hash with the
 * registration token's, which makes it the registration context for the rest of its time; registering the
 * recovery passkey deletes it, so it is single use. Never backed up.
 */
export const recoveryLink = auth.table(
  'recovery_link',
  {
    tokenHash: bytea('token_hash').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 minutes'`),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    /** The open passkey ceremony's challenge, single use, for 2 minutes at most. */
    challenge: bytea('challenge'),
    challengeExpiresAt: timestamp('challenge_expires_at', { withTimezone: true }),
  },
  (table) => [
    index('recovery_link_expires_at_idx').on(table.expiresAt),
    check('recovery_link_token_length', sql`octet_length(${table.tokenHash}) = 32`),
    check(
      'recovery_link_challenge',
      sql`(${table.challenge} IS NULL) = (${table.challengeExpiresAt} IS NULL)
          AND (${table.challenge} IS NULL OR octet_length(${table.challenge}) = 32)
          AND (${table.challenge} IS NULL OR ${table.redeemedAt} IS NOT NULL)`,
    ),
  ],
);

/** Wrong recovery codes per account (spec 0003, R6): the fifth locks recovery for 24 hours. */
export const recoveryLock = auth.table('recovery_lock', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  failures: integer('failures').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
});

/**
 * Invites (spec 0003, R2): the link token is 256 random bits and only its SHA-256 hash is stored;
 * single use through `accepted_at`, expiring after 48 hours. An accepted invite stays until the
 * inviter confirms or declines the new account; erasing either account erases the invite with
 * the invitee's address. Backed up, since an accepted invite is the lasting link between them.
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

/**
 * Erased accounts whose `account erased` event or tombstone is still owed (spec 0004, R9): written
 * with the erasure of the auth rows, so a run that fails after them is started again, and deleted
 * once the tombstone is written. The account ID only, which the audit trail keeps anyway; no
 * foreign key, since the account is gone. Never backed up: a restore takes its erasures from the
 * audit trail and the tombstones.
 */
export const erasedAccount = auth.table('erased_account', {
  accountId: uuid('account_id').primaryKey(),
  erasedAt: timestamp('erased_at', { withTimezone: true }).notNull().defaultNow(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }),
});
