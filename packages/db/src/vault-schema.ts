import { sql, type SQL } from 'drizzle-orm';
import {
  bytea,
  check,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { link } from './account-schema.js';

/**
 * The vault's server side (spec 0005, R2 and R4; ADR-0018): public recipients, sealed envelopes,
 * the owner's tagged sharing state and the documents' metadata. Nothing here is readable
 * plaintext. Every row belongs to one account and is reachable under that account's identity:
 * `app_api` for requests, `app_jobs` for erasure and the daily cleanup. The only reads across
 * accounts are a linked account's current recipient and a document shared with the reader. Like
 * audit, no foreign key reaches the auth schema: erasure removes these rows through the registry,
 * before the account itself.
 */
export const vault = pgSchema('vault');

const ownRow = (accountId: unknown): SQL =>
  sql`${accountId} = nullif(current_setting('app.account_id', true), '')::uuid`;

/** Whether the identity and `accountId` share an `account.link` row, in either direction. */
const linkedTo = (accountId: unknown): SQL =>
  sql`EXISTS (SELECT 1 FROM ${link} WHERE (${ownRow(link.inviterId)} AND ${link.inviteeId} = ${accountId}) OR (${ownRow(link.inviteeId)} AND ${link.inviterId} = ${accountId}))`;

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
    // To share with a linked account, its current recipient is readable; nothing else of it is.
    pgPolicy('recipient_select_linked', {
      for: 'select',
      to: 'app_api',
      using: sql`${table.rotatedAt} IS NULL AND ${linkedTo(table.accountId)}`,
    }),
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

/** The largest ciphertext a document may have (spec 0005, R3), in bytes. */
export const maxDocumentBytes = 25 * 1024 * 1024;

/**
 * A document's metadata; the ciphertext is a blob under `object_key`. A row is pending until the
 * upload is confirmed against its size and SHA-256, and counts against the quota either way.
 */
export const document = vault.table(
  'document',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    typeKey: text('type_key').notNull(),
    size: integer('size').notNull(),
    sha256: bytea('sha256').notNull(),
    objectKey: text('object_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (table) => [
    unique('document_id_owner_id_key').on(table.id, table.ownerId),
    uniqueIndex('document_object_key_idx').on(table.objectKey),
    index('document_owner_id_idx').on(table.ownerId),
    check('document_type_key', sql`${table.typeKey} ~ '^[a-z][a-z0-9_.-]{0,63}$'`),
    check('document_size', sql`${table.size} BETWEEN 1 AND ${sql.raw(String(maxDocumentBytes))}`),
    check('document_sha256_length', sql`octet_length(${table.sha256}) = 32`),
    check(
      'document_object_key',
      sql`${table.objectKey} ~ '^documents/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      'document_confirmed_after_created',
      sql`${table.confirmedAt} IS NULL OR ${table.confirmedAt} >= ${table.createdAt}`,
    ),
    // The recipient side reads its own share row, whose policies never read this table back.
    pgPolicy('document_select_owner_or_recipient', {
      for: 'select',
      to: 'app_api',
      using: sql`${ownRow(table.ownerId)} OR EXISTS (SELECT 1 FROM "vault"."document_recipient" r WHERE r.document_id = ${table.id} AND ${ownRow(sql`r.recipient_id`)})`,
    }),
    ...ownRowPolicies('document', table.ownerId, ['insert', 'update', 'delete']),
  ],
);

/** One share of a document: the recipient's account, which the owner chose from a link. */
export const documentRecipient = vault.table(
  'document_recipient',
  {
    documentId: uuid('document_id').notNull(),
    documentOwnerId: uuid('document_owner_id').notNull(),
    recipientId: uuid('recipient_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'document_recipient_pkey', columns: [table.documentId, table.recipientId] }),
    foreignKey({
      name: 'document_recipient_document_fkey',
      columns: [table.documentId, table.documentOwnerId],
      foreignColumns: [document.id, document.ownerId],
    }).onDelete('cascade'),
    check('document_recipient_not_owner', sql`${table.recipientId} <> ${table.documentOwnerId}`),
    index('document_recipient_recipient_id_idx').on(table.recipientId),
    index('document_recipient_owner_id_idx').on(table.documentOwnerId),
    // Owner-side policies read this row's own owner column, never the document table.
    pgPolicy('document_recipient_select_party', {
      for: 'select',
      to: 'app_api',
      using: sql`${ownRow(table.documentOwnerId)} OR ${ownRow(table.recipientId)}`,
    }),
    pgPolicy('document_recipient_insert_owner', {
      for: 'insert',
      to: 'app_api',
      withCheck: sql`${ownRow(table.documentOwnerId)} AND ${linkedTo(table.recipientId)}`,
    }),
    pgPolicy('document_recipient_delete_owner', {
      for: 'delete',
      to: 'app_api',
      using: ownRow(table.documentOwnerId),
    }),
    pgPolicy('document_recipient_select_own_by_jobs', {
      for: 'select',
      to: 'app_jobs',
      using: ownRow(table.recipientId),
    }),
    pgPolicy('document_recipient_delete_own_by_jobs', {
      for: 'delete',
      to: 'app_jobs',
      using: ownRow(table.recipientId),
    }),
  ],
);
