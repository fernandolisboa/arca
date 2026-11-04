import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Better Auth's tables (spec 0003, R1), in their own schema that only `app_auth` may read and
 * write. Property names are Better Auth's field names, which its Drizzle adapter maps by key;
 * columns are snake_case. No table in another schema references these with a cascade.
 */
export const auth = pgSchema('auth');

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const user = auth.table('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  /** For the inactivity rule in RETENTION.md. */
  lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
  /** Set at owner enrollment, or when the inviter confirms the account; restricted while null. */
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  /** While set, the account waits for erasure and may only cancel it (spec 0004, R9). */
  deletionDueAt: timestamp('deletion_due_at', { withTimezone: true }),
});

export const session = auth.table(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Better Auth's own fields, kept only because its adapter writes them; always null.
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Closed enums derived on the server from the user agent (spec 0003, R4). */
    deviceBrowser: text('device_browser').notNull(),
    deviceOs: text('device_os').notNull(),
    /** The passkey that signed this session in; revoking it ends the session (spec 0003, R4). */
    credentialId: text('credential_id').notNull(),
  },
  (table) => [
    index('session_user_id_idx').on(table.userId),
    index('session_credential_id_idx').on(table.credentialId),
    // The passkey must belong to the session's own account.
    foreignKey({
      name: 'session_credential_fkey',
      columns: [table.credentialId, table.userId],
      foreignColumns: [passkey.credentialID, passkey.userId],
    }).onDelete('cascade'),
    // Neither the IP address nor the raw user agent is ever stored (spec 0003, R4).
    check(
      'session_no_network_details',
      sql`${table.ipAddress} IS NULL AND ${table.userAgent} IS NULL`,
    ),
  ],
);

/** Unused by passkey sign-in; Better Auth's adapter expects the table. Holds no secrets. */
export const account = auth.table(
  'account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('account_user_id_idx').on(table.userId),
    check(
      'account_no_secrets',
      sql`${table.password} IS NULL AND ${table.accessToken} IS NULL AND ${table.refreshToken} IS NULL AND ${table.idToken} IS NULL`,
    ),
  ],
);

/** Short-lived ceremony state, such as WebAuthn challenges. */
export const verification = auth.table(
  'verification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

/** Passkey credentials. Only the credentials module in apps/api reads them (spec 0003, R1). */
export const passkey = auth.table(
  'passkey',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull().unique(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    aaguid: text('aaguid'),
  },
  (table) => [
    index('passkey_user_id_idx').on(table.userId),
    unique('passkey_credential_user_key').on(table.credentialID, table.userId),
  ],
);

/** The tables Better Auth's adapter maps; the others are read by Arca's own modules. */
export const authSchema = { user, session, account, verification, passkey } as const;
