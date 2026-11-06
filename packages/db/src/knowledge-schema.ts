import { sql } from 'drizzle-orm';
import { stepUp } from './step-up-schema.js';
import {
  bytea,
  check,
  integer,
  pgPolicy,
  primaryKey,
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
 * schema. Insert-only, as the audit log: `app_auth` inserts a decision in the transaction that
 * spends its step-up, and only one matching a spent `knowledge_decision` step-up of the approver,
 * since a row carries its own key and whoever may insert could otherwise sign one; `app_api` reads
 * them all, since every evaluation needs the states. With no update or delete policy under forced
 * row-level security nobody updates or deletes. Kept for good, as the record of which rules are in
 * use.
 */
export const knowledge = pgSchema('knowledge');

export const decision = knowledge.table(
  'decision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['activate', 'reject'] }).notNull(),
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
    pgPolicy('decision_insert_spent_step_up', {
      for: 'insert',
      to: 'app_auth',
      withCheck: sql`EXISTS (SELECT FROM ${stepUp}
        WHERE ${stepUp.id} = ${table.stepUpId}
          AND ${stepUp.accountId} = ${table.approverAccountId}
          AND ${stepUp.purpose} = 'knowledge_decision'
          AND ${stepUp.consumedAt} IS NOT NULL
          AND ${stepUp.credentialId} = ${table.credentialId}
          AND ${stepUp.nonce} = ${table.serverNonce}
          AND ${stepUp.authenticatorData} = ${table.authenticatorData}
          AND ${stepUp.clientDataJson} = ${table.clientDataJson}
          AND ${stepUp.signature} = ${table.signature})`,
    }),
    pgPolicy('decision_read', { for: 'select', to: 'app_api', using: sql`true` }),
  ],
);

/**
 * Model summaries of route versions for the approver (ADR-0025), kept so a summary is asked for
 * once per version, prompt and model, and shows again on the next visit. A summary reads only the
 * version's public content, so a row holds no personal data and no account: every approver reads
 * the same one. `app_api` reads and inserts them, behind the route's approver check; nobody updates
 * or deletes, so a later prompt or model writes a new row instead of changing an old one.
 */
export const ruleSummary = knowledge.table(
  'rule_summary',
  {
    contentHash: text('content_hash').notNull(),
    promptVersion: text('prompt_version').notNull(),
    model: text('model').notNull(),
    overview: text('overview').notNull(),
    watchPoints: text('watch_points').array().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'rule_summary_pkey',
      columns: [table.contentHash, table.promptVersion, table.model],
    }),
    check('rule_summary_content_hash_format', sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'rule_summary_prompt_version_format',
      sql`${table.promptVersion} ~ '^[a-z0-9][a-z0-9.-]{0,63}$'`,
    ),
    check('rule_summary_model_format', sql`${table.model} ~ '^[a-z0-9][a-z0-9.-]{0,63}$'`),
    check('rule_summary_overview_length', sql`char_length(${table.overview}) BETWEEN 1 AND 1500`),
    check(
      'rule_summary_watch_points_count',
      sql`coalesce(array_length(${table.watchPoints}, 1), 0) <= 8`,
    ),
    pgPolicy('rule_summary_read', { for: 'select', to: 'app_api', using: sql`true` }),
    pgPolicy('rule_summary_insert', { for: 'insert', to: 'app_api', withCheck: sql`true` }),
  ],
);
