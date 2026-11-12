import { sql } from 'drizzle-orm';
import {
  boolean,
  bytea,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
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
 * step-up is swept or its author's account is erased. A `session` row (ADR-0027) was made by a
 * signed-in admin with no step-up, so it has none of those fields and instead records why its
 * author was an admin: the owner list, or the admin grant in force, which it names. A database check keeps the proof and those fields consistent, and no
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
/**
 * Why an admin was one when they acted (ADR-0027): the owner list in the repository, or the admin
 * grant in force, which the row names.
 */
export const adminBases = ['owner_list', 'grant'] as const;

/** The transaction's own account, which `app_auth` sets per transaction (ADR-0008). */
const isIdentity = (column: unknown) =>
  sql`${column} = nullif(current_setting('app.account_id', true), '')::uuid`;

/** The column's grant row exists and gave the role to `account`; checked on insert. */
const grantOf = (grantId: unknown, account: unknown) =>
  sql`EXISTS (SELECT FROM "knowledge"."admin_grant" "given"
        WHERE "given"."id" = ${grantId} AND "given"."kind" = 'grant'
          AND "given"."grantee_account_id" = ${account})`;

/** An admin basis and the grant it names agree: a `grant` basis names one, the owner list none. */
const basisShape = (basis: unknown, grantId: unknown) =>
  sql`CASE ${basis} WHEN 'owner_list' THEN ${grantId} IS NULL
        WHEN 'grant' THEN ${grantId} IS NOT NULL ELSE false END`;

/**
 * The admin role's history (ADR-0027): one row when an admin gives the role and one when an admin
 * takes it away, each with both accounts, why its actor was an admin, and a time the database sets
 * after the inserting transaction's locks. A grant row names the `admin_grant` step-up its actor
 * spent; a removal row names the grant it ends. Accounts on the owner list are admins without a
 * row. Whether a row counts, and which grant is in force at a time, is computed from the history
 * by the API, so a row whose actor was never an admin counts for nothing.
 *
 * Insert-only, as decisions: `app_auth` inserts rows by the transaction's own account, and reads
 * them to check the role in the same transaction; `app_api` reads them, since every request reads
 * the role. With no update or delete policy under forced row-level security nobody changes or
 * deletes a row. Kept for good, with account IDs only, because decisions rely on them.
 */
export const adminGrant = knowledge.table(
  'admin_grant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['grant', 'removal'] }).notNull(),
    granteeAccountId: uuid('grantee_account_id').notNull(),
    actorAccountId: uuid('actor_account_id').notNull(),
    actorBasis: text('actor_basis', { enum: adminBases }).notNull(),
    /** The grant that made the actor an admin, under a `grant` basis. */
    actorGrantId: uuid('actor_grant_id'),
    /** The grant a removal ends. */
    removesGrantId: uuid('removes_grant_id'),
    /** The `admin_grant` step-up a grant row spent. */
    stepUpId: uuid('step_up_id'),
    /** Set by the database when the row is inserted, after the inserting transaction's locks. */
    at: timestamp('at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('admin_grant_step_up_id_key').on(table.stepUpId),
    check('admin_grant_kind', sql`${table.kind} IN ('grant', 'removal')`),
    check('admin_grant_actor_basis', basisShape(table.actorBasis, table.actorGrantId)),
    check(
      'admin_grant_shape',
      sql`CASE ${table.kind}
        WHEN 'grant' THEN ${table.stepUpId} IS NOT NULL AND ${table.removesGrantId} IS NULL
          AND ${table.granteeAccountId} <> ${table.actorAccountId}
        WHEN 'removal' THEN ${table.stepUpId} IS NULL AND ${table.removesGrantId} IS NOT NULL
        ELSE false END`,
    ),
    pgPolicy('admin_grant_insert_by_admin', {
      for: 'insert',
      to: 'app_auth',
      withCheck: sql`${isIdentity(table.actorAccountId)}
        AND (${table.actorBasis} = 'owner_list' OR ${grantOf(table.actorGrantId, table.actorAccountId)})
        AND CASE ${table.kind}
          WHEN 'grant' THEN EXISTS (SELECT FROM "auth"."step_up"
            WHERE "auth"."step_up"."id" = ${table.stepUpId}
              AND "auth"."step_up"."account_id" = ${table.actorAccountId}
              AND "auth"."step_up"."purpose" = 'admin_grant'
              AND "auth"."step_up"."consumed_at" IS NOT NULL)
          WHEN 'removal' THEN ${grantOf(table.removesGrantId, table.granteeAccountId)}
          ELSE false END`,
    }),
    pgPolicy('admin_grant_read_auth', { for: 'select', to: 'app_auth', using: sql`true` }),
    pgPolicy('admin_grant_read_api', { for: 'select', to: 'app_api', using: sql`true` }),
    // The correction request functions check a grant basis against the history (ADR-0029).
    pgPolicy('admin_grant_read_definer', {
      for: 'select',
      to: 'knowledge_definer',
      using: sql`true`,
    }),
  ],
);

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
    authorAccountId: uuid('approver_account_id').notNull(),
    proof: text('proof', { enum: decisionProofs }).notNull(),
    /** Why a `session` row's author was an admin; null on a `step_up` row. */
    adminBasis: text('admin_basis', { enum: adminBases }),
    /** The admin grant in force for the author, under a `grant` basis. */
    adminGrantId: uuid('admin_grant_id'),
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
        WHEN 'step_up' THEN ${table.adminBasis} IS NULL AND ${table.adminGrantId} IS NULL
          AND ${table.credentialId} IS NOT NULL AND ${table.publicKey} IS NOT NULL
          AND ${table.actionNonce} IS NOT NULL AND ${table.serverNonce} IS NOT NULL
          AND ${table.authenticatorData} IS NOT NULL AND ${table.clientDataJson} IS NOT NULL
          AND ${table.signature} IS NOT NULL AND ${table.stepUpId} IS NOT NULL
        WHEN 'session' THEN ${basisShape(table.adminBasis, table.adminGrantId)}
          AND ${table.credentialId} IS NULL AND ${table.publicKey} IS NULL
          AND ${table.actionNonce} IS NULL AND ${table.serverNonce} IS NULL
          AND ${table.authenticatorData} IS NULL AND ${table.clientDataJson} IS NULL
          AND ${table.signature} IS NULL AND ${table.stepUpId} IS NULL
        ELSE false END`,
    ),
    pgPolicy('decision_insert_session', {
      for: 'insert',
      to: 'app_auth',
      withCheck: sql`${table.proof} = 'session' AND ${isIdentity(table.authorAccountId)}
        AND (${table.adminBasis} = 'owner_list'
          OR ${grantOf(table.adminGrantId, table.authorAccountId)})`,
    }),
    pgPolicy('decision_read', { for: 'select', to: 'app_api', using: sql`true` }),
  ],
);

/**
 * Model summaries of route versions for admins (ADR-0025, ADR-0027), kept so a summary is asked for
 * once per version, prompt and model, and shows again on the next visit. A summary reads only the
 * version's public content, so a row holds no personal data and no account: every admin reads
 * the same one. `app_api` reads and inserts them, behind the route's admin check; nobody updates
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

const routeIdFormat = (column: unknown) => sql`${column} ~ '^[a-z]{2}-[a-z0-9][a-z0-9-]{0,62}$'`;
const slugFormat = (column: unknown) => sql`${column} ~ '^[a-z0-9][a-z0-9.-]{0,63}$'`;

/**
 * Starts of the independent check (ADR-0027): one row each time the activation screen starts a
 * check of a route version, so concurrent screens neither pass the automatic share of any 24 hours
 * nor start one version twice. Public rule identities only, with no account. `app_api`
 * reads and inserts them under an environment-wide advisory lock; the database sets the time;
 * nobody updates or deletes. Kept, as the record of what the checks cost.
 */
export const checkStart = knowledge.table(
  'check_start',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    routeId: text('route_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    check('check_start_route_id_format', routeIdFormat(table.routeId)),
    check('check_start_version_number_positive', sql`${table.versionNumber} > 0`),
    index('check_start_started_at_idx').on(table.startedAt),
    pgPolicy('check_start_read', { for: 'select', to: 'app_api', using: sql`true` }),
    pgPolicy('check_start_insert', { for: 'insert', to: 'app_api', withCheck: sql`true` }),
  ],
);

/**
 * Reports of the independent check (ADR-0027), one per start: what code concluded about each item
 * of a route version from a model's answer and the official pages it cites, with the fetch log.
 * Public rule data with no account, so every admin reads the same one. `app_jobs` inserts them from
 * the check's workflow step; `app_api` and `app_auth` read them; nobody updates or deletes, so a
 * later check writes a new row. `clean` is computed in code and the database refuses a row where it
 * disagrees with the items: a scripted report, an empty one or one with an item that does not match
 * is never clean.
 */
export const independentCheck = knowledge.table(
  'independent_check',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    startId: uuid('start_id').notNull(),
    routeId: text('route_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    contentHash: text('content_hash').notNull(),
    /** The country guide's content hash, or `none`. */
    guideHash: text('guide_hash').notNull(),
    promptVersion: text('prompt_version').notNull(),
    model: text('model').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    items: jsonb('items').notNull(),
    fetchLog: jsonb('fetch_log').notNull(),
    /** A fixed code when the model call failed; fetch failures are in the fetch log. */
    failure: text('failure'),
    failed: boolean('failed').notNull(),
    clean: boolean('clean').notNull(),
  },
  (table) => [
    unique('independent_check_start_id_key').on(table.startId),
    index('independent_check_version_idx').on(table.routeId, table.versionNumber),
    check('independent_check_route_id_format', routeIdFormat(table.routeId)),
    check('independent_check_version_number_positive', sql`${table.versionNumber} > 0`),
    check('independent_check_content_hash_format', sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'independent_check_guide_hash_format',
      sql`${table.guideHash} = 'none' OR ${table.guideHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check('independent_check_prompt_version_format', slugFormat(table.promptVersion)),
    check('independent_check_model_format', slugFormat(table.model)),
    check(
      'independent_check_failure_format',
      sql`${table.failure} IS NULL OR ${table.failure} ~ '^[a-z][a-z_]{0,39}$'`,
    ),
    check(
      'independent_check_items_array',
      sql`jsonb_typeof(${table.items}) = 'array' AND jsonb_array_length(${table.items}) <= 200`,
    ),
    check(
      'independent_check_fetch_log_array',
      sql`jsonb_typeof(${table.fetchLog}) = 'array' AND jsonb_array_length(${table.fetchLog}) <= 200`,
    ),
    // 'fake' is `scriptedCheckerModel` in @arca/domain, which a table check cannot import.
    check(
      'independent_check_clean',
      sql`${table.clean} = (${table.model} <> 'fake'
        AND jsonb_array_length(${table.items}) > 0
        AND NOT jsonb_path_exists(${table.items}, '$[*] ? (!exists(@.status ? (@ == "matches")))'))`,
    ),
    pgPolicy('independent_check_read', {
      for: 'select',
      to: ['app_api', 'app_auth', 'app_jobs'],
      using: sql`true`,
    }),
    pgPolicy('independent_check_insert', { for: 'insert', to: 'app_jobs', withCheck: sql`true` }),
  ],
);

/**
 * Progress of the independent check (ADR-0027, "On demand, with progress"): what one start's run
 * recorded as it went, in order, so an admin can watch it. A closed kind and a small detail of
 * counts, one cited URL and fixed codes; never page text or anything a model wrote. Public rule
 * data with no account. `app_jobs` inserts from the check's workflow step; `app_api` reads; the
 * database sets the time; nobody updates or deletes. The kinds and details are closed in code,
 * which parses each row on the way out; the table only bounds their shape.
 */
export const checkProgress = knowledge.table(
  'check_progress',
  {
    startId: uuid('start_id').notNull(),
    sequence: integer('sequence').notNull(),
    kind: text('kind').notNull(),
    detail: jsonb('detail').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({ name: 'check_progress_pkey', columns: [table.startId, table.sequence] }),
    check('check_progress_sequence_range', sql`${table.sequence} BETWEEN 0 AND 999`),
    check('check_progress_kind_format', sql`${table.kind} ~ '^[a-z][a-z_]{0,19}$'`),
    check(
      'check_progress_detail_object',
      sql`jsonb_typeof(${table.detail}) = 'object' AND length(${table.detail}::text) <= 2500`,
    ),
    pgPolicy('check_progress_read', { for: 'select', to: 'app_api', using: sql`true` }),
    pgPolicy('check_progress_insert', { for: 'insert', to: 'app_jobs', withCheck: sql`true` }),
  ],
);

/** An admin's correction request may name the whole version, its settings or one item. */
export const correctionItemKinds = [
  'version',
  'settings',
  'requirement',
  'assessment',
  'dependent',
  'cost',
  'duration',
  'countrySet',
] as const;

const inList = (column: unknown, values: readonly string[]) =>
  sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;

/** The request's author is the transaction's own account, for erasure (app_jobs). */
const ownRequest = (requestId: unknown) =>
  sql`EXISTS (SELECT FROM "knowledge"."correction_request" "request"
        WHERE "request"."id" = ${requestId}
          AND "request"."author_account_id" = nullif(current_setting('app.account_id', true), '')::uuid)`;

/**
 * Correction requests (ADR-0029): an owner-list admin points at a wrong item of a route version
 * and says what is wrong, with sources as leads. Knowledge data that names a route, a version and
 * an item, never a case or a person. Insert-only: `app_api` serves admins through the reviewed
 * definer functions of `knowledge_definer`, which check the admin basis the API computed and
 * insert or read on its behalf; the author's data export reads their own rows through one too.
 * `app_jobs` reads and deletes an author's own requests under their identity, for erasure; their
 * sources and events go with them. The daily retention step, also `app_jobs` under the author's
 * identity, clears a request's note and deletes its sources and uploads, keeping the row with its
 * identifiers and dates; that clearing is the only update.
 */
export const correctionRequest = knowledge.table(
  'correction_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    routeId: text('route_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    itemKind: text('item_kind').notNull(),
    itemKey: text('item_key'),
    /** Null once the retention step erased the request's contents. */
    note: text('note'),
    authorAccountId: uuid('author_account_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    contentErasedAt: timestamp('content_erased_at', { withTimezone: true }),
  },
  (table) => [
    check('correction_request_route_id_format', routeIdFormat(table.routeId)),
    check('correction_request_version_number_positive', sql`${table.versionNumber} > 0`),
    check('correction_request_item_kind', inList(table.itemKind, correctionItemKinds)),
    check(
      'correction_request_item_key',
      sql`CASE WHEN ${table.itemKind} IN ('version', 'settings') THEN ${table.itemKey} IS NULL
        ELSE ${table.itemKey} ~ '^[a-z0-9][a-z0-9./-]{0,79}$' END`,
    ),
    check('correction_request_note_length', sql`char_length(${table.note}) BETWEEN 1 AND 4000`),
    check(
      'correction_request_note_erased',
      sql`(${table.note} IS NULL) = (${table.contentErasedAt} IS NOT NULL)`,
    ),
    index('correction_request_version_idx').on(table.routeId, table.versionNumber),
    index('correction_request_author_account_id_idx').on(table.authorAccountId),
    pgPolicy('correction_request_insert_by_definer', {
      for: 'insert',
      to: 'knowledge_definer',
      withCheck: sql`true`,
    }),
    pgPolicy('correction_request_select_by_definer', {
      for: 'select',
      to: 'knowledge_definer',
      using: sql`true`,
    }),
    pgPolicy('correction_request_select_own_by_jobs', {
      for: 'select',
      to: 'app_jobs',
      using: isIdentity(table.authorAccountId),
    }),
    pgPolicy('correction_request_delete_own_by_jobs', {
      for: 'delete',
      to: 'app_jobs',
      using: isIdentity(table.authorAccountId),
    }),
    pgPolicy('correction_request_erase_own_by_jobs', {
      for: 'update',
      to: 'app_jobs',
      using: isIdentity(table.authorAccountId),
      withCheck: sql`${isIdentity(table.authorAccountId)} AND ${table.note} IS NULL`,
    }),
  ],
);

/** The media types a request's file may have (ADR-0029), checked by content on filing. */
export const correctionFileTypes = ['application/pdf', 'text/html', 'text/plain'] as const;

/**
 * A file an owner-list admin uploads for a request (ADR-0029): a plaintext copy of what is meant
 * to be an official text, in the private Blob store under a random `corrections/` pathname. The
 * row is made before the upload, with the size and SHA-256 the grant and the filing check; a
 * request's source names it once filed. Uploads no request names are deleted by the daily
 * retention step after a day, objects first; named ones go with their request's contents.
 */
export const correctionUpload = knowledge.table(
  'correction_upload',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorAccountId: uuid('author_account_id').notNull(),
    pathname: text('pathname').notNull(),
    mediaType: text('media_type').notNull(),
    size: integer('size').notNull(),
    sha256: bytea('sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('correction_upload_pathname_key').on(table.pathname),
    check(
      'correction_upload_pathname_format',
      sql`${table.pathname} ~ '^corrections/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check('correction_upload_media_type', inList(table.mediaType, correctionFileTypes)),
    check('correction_upload_size_range', sql`${table.size} BETWEEN 1 AND 16777216`),
    check('correction_upload_sha256_length', sql`octet_length(${table.sha256}) = 32`),
    index('correction_upload_author_account_id_idx').on(table.authorAccountId),
    pgPolicy('correction_upload_insert_by_definer', {
      for: 'insert',
      to: 'knowledge_definer',
      withCheck: sql`true`,
    }),
    pgPolicy('correction_upload_select_by_definer', {
      for: 'select',
      to: 'knowledge_definer',
      using: sql`true`,
    }),
    pgPolicy('correction_upload_select_own_by_jobs', {
      for: 'select',
      to: 'app_jobs',
      using: isIdentity(table.authorAccountId),
    }),
    pgPolicy('correction_upload_delete_own_by_jobs', {
      for: 'delete',
      to: 'app_jobs',
      using: isIdentity(table.authorAccountId),
    }),
  ],
);

/**
 * A request's sources, up to five: an `https` link, pasted text or an uploaded file, all leads
 * only (ADR-0029). A file source names its upload, which no other source names.
 */
export const correctionSource = knowledge.table(
  'correction_source',
  {
    requestId: uuid('request_id').notNull(),
    position: integer('position').notNull(),
    kind: text('kind').notNull(),
    url: text('url'),
    text: text('text'),
    uploadId: uuid('upload_id'),
  },
  (table) => [
    primaryKey({ name: 'correction_source_pkey', columns: [table.requestId, table.position] }),
    foreignKey({
      name: 'correction_source_request_fkey',
      columns: [table.requestId],
      foreignColumns: [correctionRequest.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'correction_source_upload_fkey',
      columns: [table.uploadId],
      foreignColumns: [correctionUpload.id],
    }),
    unique('correction_source_upload_once').on(table.uploadId),
    check('correction_source_position_range', sql`${table.position} BETWEEN 0 AND 4`),
    check(
      'correction_source_shape',
      sql`CASE ${table.kind}
        WHEN 'link' THEN ${table.text} IS NULL AND ${table.uploadId} IS NULL
          AND ${table.url} ~ '^https://[^[:space:]]+$' AND char_length(${table.url}) <= 2048
        WHEN 'text' THEN ${table.url} IS NULL AND ${table.uploadId} IS NULL
          AND char_length(${table.text}) BETWEEN 1 AND 20000
        WHEN 'file' THEN ${table.url} IS NULL AND ${table.text} IS NULL
          AND ${table.uploadId} IS NOT NULL
        ELSE false END`,
    ),
    pgPolicy('correction_source_insert_by_definer', {
      for: 'insert',
      to: 'knowledge_definer',
      withCheck: sql`true`,
    }),
    pgPolicy('correction_source_select_by_definer', {
      for: 'select',
      to: 'knowledge_definer',
      using: sql`true`,
    }),
    pgPolicy('correction_source_select_own_by_jobs', {
      for: 'select',
      to: 'app_jobs',
      using: ownRequest(table.requestId),
    }),
    pgPolicy('correction_source_delete_own_by_jobs', {
      for: 'delete',
      to: 'app_jobs',
      using: ownRequest(table.requestId),
    }),
  ],
);

/**
 * The corrector key (ADR-0029): the secret the scheduled corrector run presents, stored as its
 * SHA-256 only. A `created` row is inserted by `app_auth`, by an owner-list admin of the
 * transaction's own account, spending a `corrector_key` step-up in the same transaction; a
 * `revoked` row ends one key, written through a definer function. The live key is the newest
 * `created` row, unless a `revoked` row ends it or it is a year old; the API also checks that its
 * creator is still on the owner list and still has an account. Insert-only, kept with account IDs
 * and digests only, as the record of who could answer requests and when.
 */
export const correctorKey = knowledge.table(
  'corrector_key',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['created', 'revoked'] }).notNull(),
    keySha256: bytea('key_sha256'),
    /** The key a `revoked` row ends. */
    revokesKeyId: uuid('revokes_key_id'),
    actorAccountId: uuid('actor_account_id').notNull(),
    /** The `corrector_key` step-up a `created` row spent. */
    stepUpId: uuid('step_up_id'),
    at: timestamp('at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    foreignKey({
      name: 'corrector_key_revokes_fkey',
      columns: [table.revokesKeyId],
      foreignColumns: [table.id],
    }),
    unique('corrector_key_sha256_key').on(table.keySha256),
    unique('corrector_key_step_up_id_key').on(table.stepUpId),
    unique('corrector_key_revokes_once').on(table.revokesKeyId),
    check(
      'corrector_key_shape',
      sql`CASE ${table.kind}
        WHEN 'created' THEN octet_length(${table.keySha256}) = 32 AND ${table.stepUpId} IS NOT NULL
          AND ${table.revokesKeyId} IS NULL
        WHEN 'revoked' THEN ${table.keySha256} IS NULL AND ${table.stepUpId} IS NULL
          AND ${table.revokesKeyId} IS NOT NULL
        ELSE false END`,
    ),
    pgPolicy('corrector_key_insert_by_owner', {
      for: 'insert',
      to: 'app_auth',
      withCheck: sql`${table.kind} = 'created' AND ${isIdentity(table.actorAccountId)}
        AND EXISTS (SELECT FROM "auth"."step_up"
          WHERE "auth"."step_up"."id" = ${table.stepUpId}
            AND "auth"."step_up"."account_id" = ${table.actorAccountId}
            AND "auth"."step_up"."purpose" = 'corrector_key'
            AND "auth"."step_up"."consumed_at" IS NOT NULL)`,
    }),
    pgPolicy('corrector_key_revoke_by_definer', {
      for: 'insert',
      to: 'knowledge_definer',
      withCheck: sql`${table.kind} = 'revoked'`,
    }),
    pgPolicy('corrector_key_select_by_definer', {
      for: 'select',
      to: 'knowledge_definer',
      using: sql`true`,
    }),
  ],
);

/** What happened to a request after it was filed (ADR-0029). */
export const correctionEventKinds = ['taken', 'answered', 'closed'] as const;

/**
 * What happened to a request after it was filed (ADR-0029): the corrector run took it or answered
 * it, with the key that did, or an admin closed it. An answer proposes a version or explains, in
 * up to 2,000 characters, why nothing changed. Each kind happens once per request. Whether a
 * decision closed a request is computed from the catalog and the decisions, never stored.
 */
export const correctionEvent = knowledge.table(
  'correction_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull(),
    kind: text('kind').notNull(),
    /** The corrector key that took or answered the request; null for an admin's close. */
    correctorKeyId: uuid('corrector_key_id'),
    proposedVersion: integer('proposed_version'),
    explanation: text('explanation'),
    at: timestamp('at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    foreignKey({
      name: 'correction_event_request_fkey',
      columns: [table.requestId],
      foreignColumns: [correctionRequest.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'correction_event_corrector_key_fkey',
      columns: [table.correctorKeyId],
      foreignColumns: [correctorKey.id],
    }),
    check('correction_event_kind', inList(table.kind, correctionEventKinds)),
    check(
      'correction_event_shape',
      sql`CASE ${table.kind}
        WHEN 'closed' THEN ${table.correctorKeyId} IS NULL AND ${table.proposedVersion} IS NULL
          AND ${table.explanation} IS NULL
        WHEN 'taken' THEN ${table.correctorKeyId} IS NOT NULL AND ${table.proposedVersion} IS NULL
          AND ${table.explanation} IS NULL
        WHEN 'answered' THEN ${table.correctorKeyId} IS NOT NULL
          AND (${table.proposedVersion} IS NULL) <> (${table.explanation} IS NULL)
          AND coalesce(${table.proposedVersion} > 0, true)
          AND coalesce(char_length(${table.explanation}) BETWEEN 1 AND 2000, true)
        ELSE false END`,
    ),
    unique('correction_event_once').on(table.requestId, table.kind),
    pgPolicy('correction_event_insert_by_definer', {
      for: 'insert',
      to: 'knowledge_definer',
      withCheck: sql`true`,
    }),
    pgPolicy('correction_event_select_by_definer', {
      for: 'select',
      to: 'knowledge_definer',
      using: sql`true`,
    }),
    pgPolicy('correction_event_select_own_by_jobs', {
      for: 'select',
      to: 'app_jobs',
      using: ownRequest(table.requestId),
    }),
  ],
);
