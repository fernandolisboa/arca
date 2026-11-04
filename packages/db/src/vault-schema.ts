import { sql, type SQL } from 'drizzle-orm';
import {
  bytea,
  check,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The vault's server side (spec 0005, R2; ADR-0018): public recipients, sealed envelopes and the
 * owner's tagged sharing state. Nothing here is readable plaintext. Every row belongs to one
 * account and is reachable only under that account's identity: `app_api` for requests,
 * `app_jobs` for erasure and the daily cleanup. Like audit, no foreign key reaches the auth
 * schema: erasure removes these rows through the registry, before the account itself.
 */
export const vault = pgSchema('vault');

const ownRow = (accountId: unknown): SQL =>
  sql`${accountId} = nullif(current_setting('app.account_id', true), '')::uuid`;

/** One policy per command and role, each holding only under the row owner's identity. */
function ownRowPolicies(
  table: string,
  accountId: unknown,
  api: readonly ('select' | 'insert' | 'update' | 'delete')[],
) {
  const own = ownRow(accountId);
  return [
    ...api.map((command) =>
      pgPolicy(`${table}_${command}_own`, {
        for: command,
        to: 'app_api',
        ...(command === 'insert' ? { withCheck: own } : { using: own }),
        ...(command === 'update' ? { withCheck: own } : {}),
      }),
    ),
    pgPolicy(`${table}_select_own_by_jobs`, { for: 'select', to: 'app_jobs', using: own }),
    pgPolicy(`${table}_delete_own_by_jobs`, { for: 'delete', to: 'app_jobs', using: own }),
  ];
}

/** A person's public vault recipients; one is current, a rotated one stays while still needed. */
export const recipient = vault.table(
  'recipient',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull(),
    recipient: text('recipient').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  },
  (table) => [
    check('recipient_hybrid', sql`${table.recipient} ~ '^age1pq1[02-9ac-hj-np-z]+$'`),
    check('recipient_length', sql`char_length(${table.recipient}) BETWEEN 8 AND 2100`),
    check(
      'recipient_rotated_after_created',
      sql`${table.rotatedAt} IS NULL OR ${table.rotatedAt} >= ${table.createdAt}`,
    ),
    unique('recipient_id_account_id_key').on(table.id, table.accountId),
    uniqueIndex('recipient_current_idx')
      .on(table.accountId)
      .where(sql`${table.rotatedAt} IS NULL`),
    ...ownRowPolicies('recipient', table.accountId, ['select', 'insert', 'update', 'delete']),
  ],
);

/** A recipient's identity sealed to one unlock method: a passkey's PRF or the recovery secret. */
export const envelope = vault.table(
  'envelope',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull(),
    recipientId: uuid('recipient_id').notNull(),
    kind: text('kind').notNull(),
    /** The passkey's credential ID (base64url) for `passkey_prf`; null for `recovery`. */
    credentialId: text('credential_id'),
    /** The age file; ciphertext only. */
    ciphertext: bytea('ciphertext').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'envelope_recipient_fkey',
      columns: [table.recipientId, table.accountId],
      foreignColumns: [recipient.id, recipient.accountId],
    }).onDelete('cascade'),
    check('envelope_kind', sql`${table.kind} IN ('passkey_prf', 'recovery')`),
    check(
      'envelope_credential_for_passkey',
      sql`(${table.kind} = 'passkey_prf') = (${table.credentialId} IS NOT NULL)`,
    ),
    check(
      'envelope_credential_format',
      sql`${table.credentialId} ~ '^[A-Za-z0-9_-]+$' AND char_length(${table.credentialId}) BETWEEN 16 AND 1366`,
    ),
    check('envelope_age_file', sql`octet_length(${table.ciphertext}) BETWEEN 64 AND 16384`),
    uniqueIndex('envelope_passkey_idx')
      .on(table.recipientId, table.credentialId)
      .where(sql`${table.kind} = 'passkey_prf'`),
    uniqueIndex('envelope_recovery_idx')
      .on(table.recipientId)
      .where(sql`${table.kind} = 'recovery'`),
    index('envelope_account_id_idx').on(table.accountId),
    ...ownRowPolicies('envelope', table.accountId, ['select', 'insert', 'update', 'delete']),
  ],
);

/** The owner's sharing state as the device tagged it; the server can store it, never forge it. */
export const sharingState = vault.table(
  'sharing_state',
  {
    accountId: uuid('account_id').primaryKey(),
    version: integer('version').notNull(),
    state: bytea('state').notNull(),
    tag: bytea('tag').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('sharing_state_version', sql`${table.version} > 0`),
    check('sharing_state_tag_length', sql`octet_length(${table.tag}) = 32`),
    check('sharing_state_size', sql`octet_length(${table.state}) <= 1048576`),
    ...ownRowPolicies('sharing_state', table.accountId, ['select', 'insert', 'update', 'delete']),
  ],
);
