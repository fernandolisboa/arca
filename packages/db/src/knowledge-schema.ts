import { sql } from 'drizzle-orm';
import {
  bytea,
  check,
  integer,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Decisions on route versions (spec 0007, R7; ADR-0022). Each row is self-contained: it copies the
 * step-up's assertion and the passkey's public key, so it verifies again after the passkey is
 * revoked, the step-up is swept or the approver's account is erased, and no foreign key leaves this
 * schema. Insert-only, as the audit log: `app_api` inserts its own decisions and reads them all,
 * since every evaluation needs the states, and with no update or delete policy under forced
 * row-level security nobody updates or deletes. Kept for good, as the record of which rules are in
 * use.
 */
export const knowledge = pgSchema('knowledge');

export const decision = knowledge.table(
  'decision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    routeId: text('route_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    contentHash: text('content_hash').notNull(),
    approverAccountId: uuid('approver_account_id').notNull(),
    credentialId: text('credential_id').notNull(),
    /** The COSE public key, copied when the step-up was consumed. */
    publicKey: bytea('public_key').notNull(),
    /** The client's 16-byte action nonce, inside the subject hash. */
    actionNonce: bytea('action_nonce').notNull(),
    /** The step-up's 32-byte server nonce, inside the challenge. */
    serverNonce: bytea('server_nonce').notNull(),
    authenticatorData: bytea('authenticator_data').notNull(),
    clientDataJson: bytea('client_data_json').notNull(),
    signature: bytea('signature').notNull(),
    stepUpId: uuid('step_up_id').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('decision_step_up_id_key').on(table.stepUpId),
    check('decision_kind', sql`${table.kind} IN ('activate', 'reject')`),
    check('decision_route_id_format', sql`${table.routeId} ~ '^[a-z]{2}-[a-z0-9][a-z0-9-]{0,62}$'`),
    check('decision_version_number_positive', sql`${table.versionNumber} > 0`),
    check('decision_content_hash_format', sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
    check('decision_action_nonce_length', sql`octet_length(${table.actionNonce}) = 16`),
    check('decision_server_nonce_length', sql`octet_length(${table.serverNonce}) = 32`),
    pgPolicy('decision_insert_own', {
      for: 'insert',
      to: 'app_api',
      withCheck: sql`${table.approverAccountId} = nullif(current_setting('app.account_id', true), '')::uuid`,
    }),
    pgPolicy('decision_read', { for: 'select', to: 'app_api', using: sql`true` }),
  ],
);
