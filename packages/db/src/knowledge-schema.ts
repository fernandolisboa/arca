import { sql } from 'drizzle-orm';
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
 * Decisions on route and comparison versions (spec 0007, R7; ADR-0022, ADR-0026, ADR-0027). A row
 * names its subject kind, and a database check gives each kind its own shape: a route row has a
 * route ID and no comparison ID, a comparison row the one comparison series ID and no route ID.
 *
 * A row also names its proof. A `step_up` row was stored under ADR-0022: it copies the step-up's
 * assertion and the passkey's public key, so it verifies again after the passkey is revoked, the
 * step-up is swept or the approver's account is erased. A `session` row (ADR-0027) was made by a
 * signed-in admin with no step-up, so it has none of those fields and instead records why its
 * author was an admin. A database check keeps the proof and those fields consistent, and no
 * foreign key leaves this schema.
 *
 * Insert-only, as the audit log: `app_auth` inserts only `session` rows, by the transaction's own
 * account, with the time the database sets; `app_api` reads them all, since every evaluation needs
 * the states. With no update or delete policy under forced row-level security nobody updates or
 * deletes. Kept for good, as the record of which rule and comparison versions are in use.
 */
export const knowledge = pgSchema('knowledge');

/** How a decision proves a person made it: a step-up (ADR-0022) or an admin's session (ADR-0027). */
export const decisionProofs = ['step_up', 'session'] as const;
/** Why a `session` decision's author was an admin (ADR-0027). */
export const adminBases = ['owner_list'] as const;

export const decision = knowledge.table(
  'decision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['activate', 'reject'] }).notNull(),
    subjectKind: text('subject_kind', { enum: ['route', 'comparison'] }).notNull(),
    routeId: text('route_id'),
    comparisonId: text('comparison_id'),
    versionNumber: integer('version_number').notNull(),
    contentHash: text('content_hash').notNull(),
    approverAccountId: uuid('approver_account_id').notNull(),
    proof: text('proof', { enum: decisionProofs }).notNull(),
    /** Why a `session` row's author was an admin; null on a `step_up` row. */
    adminBasis: text('admin_basis', { enum: adminBases }),
    credentialId: text('credential_id'),
    /** The COSE public key, copied when the step-up was consumed. */
    publicKey: bytea('public_key'),
    /** The client's 16-byte action nonce, inside the subject hash. */
    actionNonce: bytea('action_nonce'),
    /** The step-up's 32-byte server nonce, inside the challenge. */
    serverNonce: bytea('server_nonce'),
    authenticatorData: bytea('authenticator_data'),
    clientDataJson: bytea('client_data_json'),
    signature: bytea('signature'),
    stepUpId: uuid('step_up_id'),
    /** Set by the database when the row is inserted, after the inserting transaction's lock. */
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('decision_step_up_id_key').on(table.stepUpId),
    check('decision_kind', sql`${table.kind} IN ('activate', 'reject')`),
    check('decision_route_id_format', sql`${table.routeId} ~ '^[a-z]{2}-[a-z0-9][a-z0-9-]{0,62}$'`),
    // 'destinations' is the domain's `comparisonSeriesId`; the knowledge build refuses any other.
    check(
      'decision_subject',
      sql`CASE ${table.subjectKind}
        WHEN 'route' THEN ${table.routeId} IS NOT NULL AND ${table.comparisonId} IS NULL
        WHEN 'comparison' THEN ${table.routeId} IS NULL
          AND ${table.comparisonId} IS NOT DISTINCT FROM 'destinations'
        ELSE false END`,
    ),
    check('decision_version_number_positive', sql`${table.versionNumber} > 0`),
    check('decision_content_hash_format', sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
    check('decision_action_nonce_length', sql`octet_length(${table.actionNonce}) = 16`),
    check('decision_server_nonce_length', sql`octet_length(${table.serverNonce}) = 32`),
    check(
      'decision_proof',
      sql`CASE ${table.proof}
        WHEN 'step_up' THEN ${table.adminBasis} IS NULL
          AND ${table.credentialId} IS NOT NULL AND ${table.publicKey} IS NOT NULL
          AND ${table.actionNonce} IS NOT NULL AND ${table.serverNonce} IS NOT NULL
          AND ${table.authenticatorData} IS NOT NULL AND ${table.clientDataJson} IS NOT NULL
          AND ${table.signature} IS NOT NULL AND ${table.stepUpId} IS NOT NULL
        WHEN 'session' THEN ${table.adminBasis} IS NOT DISTINCT FROM 'owner_list'
          AND ${table.credentialId} IS NULL AND ${table.publicKey} IS NULL
          AND ${table.actionNonce} IS NULL AND ${table.serverNonce} IS NULL
          AND ${table.authenticatorData} IS NULL AND ${table.clientDataJson} IS NULL
          AND ${table.signature} IS NULL AND ${table.stepUpId} IS NULL
        ELSE false END`,
    ),
    pgPolicy('decision_insert_session', {
      for: 'insert',
      to: 'app_auth',
      withCheck: sql`${table.proof} = 'session'
        AND ${table.approverAccountId} = nullif(current_setting('app.account_id', true), '')::uuid`,
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
