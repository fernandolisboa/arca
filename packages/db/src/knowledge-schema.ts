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
 * author was an admin: the owner list, or the admin grant in force, which it names. An
 * `admin_step_up` row (ADR-0031) has both: the copied assertion, public key and spent step-up, and
 * the admin basis; a route row also names the hash of the cases the admin approved. A database
 * check keeps the proof and those fields consistent, and no foreign key leaves this schema.
 *
 * Insert-only, as the audit log: `app_auth` inserts only `admin_step_up` rows, by the transaction's
 * own account, copying a `knowledge_decision` step-up that account spent, with the time the
 * database sets; rows of the older proofs stay and count as they say. `app_api` reads them all,
 * since every evaluation needs the states. With no update or delete policy under forced row-level
 * security nobody updates or deletes. Kept for good, as the record of which rule and comparison
 * versions are in use.
 */
export const knowledge = pgSchema('knowledge');

/**
 * How a decision proves a person made it: a step-up (ADR-0022), an admin's session (ADR-0027), or
 * an admin's step-up (ADR-0031), the only one stored now.
 */
export const decisionProofs = ['step_up', 'session', 'admin_step_up'] as const;
/**
 * Why an admin was one when they acted (ADR-0027): the owner list in the repository, or the admin
 * grant in force, which the row names.
 */
export const adminBases = ['owner_list', 'grant'] as const;

const contentHashFormat = (column: unknown) => sql`${column} ~ '^[0-9a-f]{64}$'`;

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
    /** Why the author was an admin; null on a `step_up` row. */
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
    /** The hash of the route version's cases the admin approved, on an `admin_step_up` route row. */
    casesHash: text('cases_hash'),
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
        WHEN 'admin_step_up' THEN ${basisShape(table.adminBasis, table.adminGrantId)}
          AND ${table.credentialId} IS NOT NULL AND ${table.publicKey} IS NOT NULL
          AND ${table.actionNonce} IS NOT NULL AND ${table.serverNonce} IS NOT NULL
          AND ${table.authenticatorData} IS NOT NULL AND ${table.clientDataJson} IS NOT NULL
          AND ${table.signature} IS NOT NULL AND ${table.stepUpId} IS NOT NULL
          AND (${table.casesHash} IS NOT NULL) = (${table.subjectKind} = 'route')
        ELSE false END`,
    ),
    check(
      'decision_cases_hash',
      sql`${table.casesHash} IS NULL OR (${table.proof} = 'admin_step_up' AND ${contentHashFormat(table.casesHash)})`,
    ),
    // The row copies the step-up its author spent for this purpose, field by field (ADR-0031).
    pgPolicy('decision_insert_with_step_up', {
      for: 'insert',
      to: 'app_auth',
      withCheck: sql`${table.proof} = 'admin_step_up' AND ${isIdentity(table.authorAccountId)}
        AND (${table.adminBasis} = 'owner_list'
          OR ${grantOf(table.adminGrantId, table.authorAccountId)})
        AND EXISTS (SELECT FROM "auth"."step_up"
          WHERE "auth"."step_up"."id" = ${table.stepUpId}
            AND "auth"."step_up"."account_id" = ${table.authorAccountId}
            AND "auth"."step_up"."purpose" = 'knowledge_decision'
            AND "auth"."step_up"."consumed_at" IS NOT NULL
            AND "auth"."step_up"."credential_id" = ${table.credentialId}
            AND "auth"."step_up"."nonce" = ${table.serverNonce}
            AND "auth"."step_up"."authenticator_data" = ${table.authenticatorData}
            AND "auth"."step_up"."client_data_json" = ${table.clientDataJson}
            AND "auth"."step_up"."signature" = ${table.signature})`,
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
/** A fixed code, such as a failure's. */
const slugCode = (column: unknown) => sql`${column} ~ '^[a-z][a-z_]{0,63}$'`;

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

/**
 * An admin's correction request may name the whole version, its settings or one item; a request
 * for a new route names a country and no version.
 */
export const correctionItemKinds = [
  'newRoute',
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
 * and says what is wrong, with sources as leads, or asks for a route the catalog lacks in one
 * country, with copies of its official pages and their passages. Knowledge data that names a
 * route, a version and an item, or a country, never a case or a person. Insert-only: `app_api` serves admins through the reviewed
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
    /** Null, with the version, for a request for a new route, which names its country instead. */
    routeId: text('route_id'),
    versionNumber: integer('version_number'),
    countryCode: text('country_code'),
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
      'correction_request_target',
      sql`CASE WHEN ${table.itemKind} = 'newRoute'
        THEN ${table.routeId} IS NULL AND ${table.versionNumber} IS NULL
          AND ${table.countryCode} IS NOT NULL AND ${table.countryCode} ~ '^[a-z]{2}$'
        ELSE ${table.routeId} IS NOT NULL AND ${table.versionNumber} IS NOT NULL
          AND ${table.countryCode} IS NULL END`,
    ),
    check(
      'correction_request_item_key',
      sql`CASE WHEN ${table.itemKind} IN ('newRoute', 'version', 'settings') THEN ${table.itemKey} IS NULL
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
 * A request's sources, up to five on a version and twenty for a new route: an `https` link,
 * pasted text, with the page it was copied from if any, or an uploaded file, all leads only
 * (ADR-0029). A file source names its upload, which no other source names, and may name the
 * official page it is a copy of, which the independent check reads when it cannot read the page.
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
    pageUrl: text('page_url'),
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
    check('correction_source_position_range', sql`${table.position} BETWEEN 0 AND 19`),
    check(
      'correction_source_shape',
      sql`CASE ${table.kind}
        WHEN 'link' THEN ${table.text} IS NULL AND ${table.uploadId} IS NULL
          AND ${table.pageUrl} IS NULL
          AND ${table.url} ~ '^https://[^[:space:]]+$' AND char_length(${table.url}) <= 2048
        WHEN 'text' THEN ${table.uploadId} IS NULL
          AND ${table.pageUrl} IS NULL AND char_length(${table.text}) BETWEEN 1 AND 20000
          AND (${table.url} IS NULL OR (${table.url} ~ '^https://[^[:space:]]+$'
            AND char_length(${table.url}) <= 2048))
        WHEN 'file' THEN ${table.url} IS NULL AND ${table.text} IS NULL
          AND ${table.uploadId} IS NOT NULL
          AND (${table.pageUrl} IS NULL OR (${table.pageUrl} ~ '^https://[^[:space:]]+$'
            AND char_length(${table.pageUrl}) <= 2048))
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
    /** The route of the proposed version, only on an answer to a request for a new route. */
    proposedRouteId: text('proposed_route_id'),
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
          AND ${table.explanation} IS NULL AND ${table.proposedRouteId} IS NULL
        WHEN 'taken' THEN ${table.correctorKeyId} IS NOT NULL AND ${table.proposedVersion} IS NULL
          AND ${table.explanation} IS NULL AND ${table.proposedRouteId} IS NULL
        WHEN 'answered' THEN ${table.correctorKeyId} IS NOT NULL
          AND (${table.proposedVersion} IS NULL) <> (${table.explanation} IS NULL)
          AND (${table.proposedRouteId} IS NULL OR (${table.proposedVersion} IS NOT NULL
            AND ${routeIdFormat(table.proposedRouteId)}))
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

const ruleFileIdFormat = (column: unknown) => sql`${column} ~ '^[a-z0-9][a-z0-9-]{0,63}$'`;

/**
 * The policies of a rule table (ADR-0031): `app_api` and `app_jobs` read every row, since every
 * evaluation and every view reads the rules; only `app_migrator`, which owns the table and runs
 * the reviewed import, inserts. With no update or delete policy under forced row-level security,
 * and no such grant to any role, nobody changes or deletes a row.
 */
const ruleRowPolicies = (name: string) => [
  pgPolicy(`${name}_read`, { for: 'select', to: ['app_api', 'app_jobs'], using: sql`true` }),
  pgPolicy(`${name}_import_read`, { for: 'select', to: 'app_migrator', using: sql`true` }),
  pgPolicy(`${name}_import`, { for: 'insert', to: 'app_migrator', withCheck: sql`true` }),
];

/**
 * Route versions (ADR-0031): one immutable row per route ID and number, with the version's
 * content, its content hash over everything it pins (spec 0002, R6) and its table-driven cases
 * (R8). The content names the ID and number the row is stored under. The API recomputes the hash
 * when it reads a row and leaves out one that does not match, so a row changed behind the grants is
 * never evaluated. Public rule data, no account.
 *
 * Besides the import, two writers insert, each only its own kind of row: `app_jobs` stores an
 * update request's proposal, naming the request whose end holds that very hash, once per request;
 * `knowledge_definer` stores an admin's edited version through `knowledge.edit_route_version`,
 * naming no request. Neither decides anything: a new row reads as proposed until a decision.
 */
export const routeVersion = knowledge.table(
  'route_version',
  {
    routeId: text('route_id').notNull(),
    number: integer('number').notNull(),
    content: jsonb('content').notNull(),
    contentHash: text('content_hash').notNull(),
    /**
     * The version's cases file, if it has one, outside the hash: the activation screen shows it and
     * the rule summary reads it, so it must be bound to a hash before a role other than the migrator
     * inserts rows (ADR-0031).
     */
    cases: jsonb('cases'),
    /** The update request whose proposal this row is; null for an imported or edited row. */
    requestId: uuid('request_id').references(() => updateRequest.id),
    /** Set by the database when the row is inserted. */
    insertedAt: timestamp('inserted_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({ name: 'route_version_pkey', columns: [table.routeId, table.number] }),
    unique('route_version_request_id_key').on(table.requestId),
    check('route_version_route_id_format', routeIdFormat(table.routeId)),
    check('route_version_number_positive', sql`${table.number} > 0`),
    check('route_version_content_hash_format', contentHashFormat(table.contentHash)),
    check(
      'route_version_content_identity',
      sql`${table.content} ->> 'routeId' = ${table.routeId}
        AND ${table.content} -> 'number' = pg_catalog.to_jsonb(${table.number})`,
    ),
    ...ruleRowPolicies('route_version'),
    pgPolicy('route_version_insert_proposal', {
      for: 'insert',
      to: 'app_jobs',
      withCheck: sql`EXISTS (SELECT FROM "knowledge"."update_end" "ended"
          JOIN "knowledge"."update_request" "asked" ON "asked"."id" = "ended"."request_id"
        WHERE "ended"."request_id" = ${table.requestId} AND "ended"."failure" IS NULL
          AND "ended"."content_hash" = ${table.contentHash}
          AND "asked"."route_id" = ${table.routeId})`,
    }),
    pgPolicy('route_version_read_definer', {
      for: 'select',
      to: 'knowledge_definer',
      using: sql`true`,
    }),
    pgPolicy('route_version_insert_edit', {
      for: 'insert',
      to: 'knowledge_definer',
      withCheck: sql`${table.requestId} IS NULL`,
    }),
  ],
);

/**
 * What an admin changed by hand in an edited route version (ADR-0031): the item, the official page
 * and the quote code found on it. One row per edited version, inserted with the version by
 * `knowledge.edit_route_version`; who edited is in the audit log, so a row names no account.
 * `app_api` reads them; nobody updates or deletes.
 */
export const versionEdit = knowledge.table(
  'version_edit',
  {
    routeId: text('route_id').notNull(),
    number: integer('number').notNull(),
    itemKey: text('item_key').notNull(),
    url: text('url').notNull(),
    quote: text('quote').notNull(),
    at: timestamp('at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({ name: 'version_edit_pkey', columns: [table.routeId, table.number] }),
    foreignKey({
      name: 'version_edit_version_fkey',
      columns: [table.routeId, table.number],
      foreignColumns: [routeVersion.routeId, routeVersion.number],
    }),
    check('version_edit_item_key_length', sql`char_length(${table.itemKey}) BETWEEN 1 AND 120`),
    check('version_edit_url_length', sql`char_length(${table.url}) BETWEEN 1 AND 2000`),
    check('version_edit_quote_length', sql`char_length(${table.quote}) BETWEEN 1 AND 2000`),
    pgPolicy('version_edit_read', { for: 'select', to: 'app_api', using: sql`true` }),
    pgPolicy('version_edit_insert_by_definer', {
      for: 'insert',
      to: 'knowledge_definer',
      withCheck: sql`true`,
    }),
  ],
);

/** Country sets (ADR-0031), on the same terms as route versions. */
export const countrySet = knowledge.table(
  'country_set',
  {
    setId: text('set_id').notNull(),
    number: integer('number').notNull(),
    content: jsonb('content').notNull(),
    contentHash: text('content_hash').notNull(),
    insertedAt: timestamp('inserted_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({ name: 'country_set_pkey', columns: [table.setId, table.number] }),
    check('country_set_set_id_format', ruleFileIdFormat(table.setId)),
    check('country_set_number_positive', sql`${table.number} > 0`),
    check('country_set_content_hash_format', contentHashFormat(table.contentHash)),
    check(
      'country_set_content_identity',
      sql`${table.content} ->> 'id' = ${table.setId}
        AND ${table.content} -> 'number' = pg_catalog.to_jsonb(${table.number})`,
    ),
    ...ruleRowPolicies('country_set'),
  ],
);

/**
 * Official-domain lists (ADR-0031), on the same terms. A list pins nothing, so its hash covers its
 * content alone, in the same `{ version, pinned }` form.
 */
export const officialDomainList = knowledge.table(
  'official_domain_list',
  {
    listId: text('list_id').notNull(),
    number: integer('number').notNull(),
    content: jsonb('content').notNull(),
    contentHash: text('content_hash').notNull(),
    insertedAt: timestamp('inserted_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({ name: 'official_domain_list_pkey', columns: [table.listId, table.number] }),
    check('official_domain_list_list_id_format', ruleFileIdFormat(table.listId)),
    check('official_domain_list_number_positive', sql`${table.number} > 0`),
    check('official_domain_list_content_hash_format', contentHashFormat(table.contentHash)),
    check(
      'official_domain_list_content_identity',
      sql`${table.content} ->> 'id' = ${table.listId}
        AND ${table.content} -> 'number' = pg_catalog.to_jsonb(${table.number})`,
    ),
    ...ruleRowPolicies('official_domain_list'),
  ],
);

/** The AI providers whose keys settings hold (ADR-0031): Claude for research and correction, Jev for validation. */
export const aiProviders = ['anthropic', 'typesafe'] as const;

/** The stages of an update request whose model and effort settings choose (ADR-0031). */
export const aiStages = ['research', 'validation', 'correction'] as const;

/**
 * The AI providers' API keys (ADR-0031), insert-only: a `set` row holds one key encrypted with
 * AES-256-GCM under the key-encryption key, its 96-bit nonce, its 128-bit tag, the version of the
 * key-encryption key and of the format, and its last four characters; a `removed` row ends the key
 * of the same provider it names. A provider's key is its newest `set` row no removal names. `app_auth` inserts both kinds, by the
 * transaction's own account, in the transaction that spends that account's `ai_key` step-up, with
 * the time the database sets; `app_api` and `app_jobs` read the rows, ciphertext only. With no
 * update or delete policy under forced row-level security nobody changes a row.
 */
export const aiKey = knowledge.table(
  'ai_key',
  {
    id: uuid('id').primaryKey(),
    provider: text('provider', { enum: aiProviders }).notNull(),
    kind: text('kind', { enum: ['set', 'removed'] }).notNull(),
    ciphertext: bytea('ciphertext'),
    nonce: bytea('nonce'),
    tag: bytea('tag'),
    /** The key-encryption key's version, so a rotated one is told apart. */
    kekVersion: integer('kek_version'),
    formatVersion: integer('format_version'),
    lastFour: text('last_four'),
    /** The key a `removed` row ends. */
    removesKeyId: uuid('removes_key_id'),
    actorAccountId: uuid('actor_account_id').notNull(),
    /** The `ai_key` step-up the row spent. */
    stepUpId: uuid('step_up_id').notNull(),
    at: timestamp('at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    // A removal ends a key of its own provider.
    unique('ai_key_id_provider_key').on(table.id, table.provider),
    foreignKey({
      name: 'ai_key_removes_fkey',
      columns: [table.removesKeyId, table.provider],
      foreignColumns: [table.id, table.provider],
    }),
    unique('ai_key_step_up_id_key').on(table.stepUpId),
    unique('ai_key_removes_once').on(table.removesKeyId),
    index('ai_key_provider_at_idx').on(table.provider, table.at),
    check('ai_key_provider', inList(table.provider, aiProviders)),
    check(
      'ai_key_shape',
      sql`CASE ${table.kind}
        WHEN 'set' THEN octet_length(${table.ciphertext}) BETWEEN 1 AND 1024
          AND octet_length(${table.nonce}) = 12 AND octet_length(${table.tag}) = 16
          AND ${table.kekVersion} > 0 AND ${table.formatVersion} = 1
          AND char_length(${table.lastFour}) = 4 AND ${table.removesKeyId} IS NULL
        WHEN 'removed' THEN ${table.ciphertext} IS NULL AND ${table.nonce} IS NULL
          AND ${table.tag} IS NULL AND ${table.kekVersion} IS NULL
          AND ${table.formatVersion} IS NULL AND ${table.lastFour} IS NULL
          AND ${table.removesKeyId} IS NOT NULL
        ELSE false END`,
    ),
    pgPolicy('ai_key_insert_with_step_up', {
      for: 'insert',
      to: 'app_auth',
      withCheck: sql`${isIdentity(table.actorAccountId)}
        AND EXISTS (SELECT FROM "auth"."step_up"
          WHERE "auth"."step_up"."id" = ${table.stepUpId}
            AND "auth"."step_up"."account_id" = ${table.actorAccountId}
            AND "auth"."step_up"."purpose" = 'ai_key'
            AND "auth"."step_up"."consumed_at" IS NOT NULL)`,
    }),
    pgPolicy('ai_key_read', { for: 'select', to: ['app_api', 'app_jobs'], using: sql`true` }),
  ],
);

/**
 * The model and effort an admin chose for a stage (ADR-0031), insert-only; the newest row of a
 * stage decides and the defaults in reviewed code apply while there is none. Written only through
 * `knowledge.set_ai_stage`, which re-checks the admin basis and has no access to the key rows;
 * `app_api` and `app_jobs` read them. Who chose is in the audit log, so a row names no account.
 */
export const aiStageSetting = knowledge.table(
  'ai_stage_setting',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stage: text('stage', { enum: aiStages }).notNull(),
    model: text('model').notNull(),
    /** Null for a model that takes no effort. */
    effort: text('effort'),
    at: timestamp('at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index('ai_stage_setting_stage_at_idx').on(table.stage, table.at),
    check('ai_stage_setting_stage', inList(table.stage, aiStages)),
    check('ai_stage_setting_model_format', sql`${table.model} ~ '^[a-z0-9][a-z0-9.-]{0,63}$'`),
    check(
      'ai_stage_setting_effort',
      sql`${table.effort} IS NULL OR ${table.effort} IN ('low', 'medium', 'high', 'xhigh', 'max')`,
    ),
    pgPolicy('ai_stage_setting_read', {
      for: 'select',
      to: ['app_api', 'app_jobs'],
      using: sql`true`,
    }),
    pgPolicy('ai_stage_setting_insert_by_definer', {
      for: 'insert',
      to: 'knowledge_definer',
      withCheck: sql`true`,
    }),
  ],
);

/** The stages of an update request (ADR-0031), as `@arca/domain` names them. */
export const updateStages = ['research', 'validation', 'correction', 'final_validation'] as const;

/**
 * Update requests (ADR-0031): one row each time an admin asks for a route to be researched again,
 * naming the route and the version it updates, with no account (the audit log names who asked).
 * Inserted only through `knowledge.start_update_request`, which re-checks the admin basis and,
 * under a lock per route, refuses a second live request; `app_api` and `app_jobs` read them; the
 * database sets the time; nobody updates or deletes.
 */
export const updateRequest = knowledge.table(
  'update_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    routeId: text('route_id').notNull(),
    baseNumber: integer('base_number').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    check('update_request_route_id_format', routeIdFormat(table.routeId)),
    check('update_request_base_number_positive', sql`${table.baseNumber} > 0`),
    index('update_request_route_requested_idx').on(table.routeId, table.requestedAt),
    pgPolicy('update_request_read', {
      for: 'select',
      to: ['app_api', 'app_jobs', 'knowledge_definer'],
      using: sql`true`,
    }),
    pgPolicy('update_request_insert_by_definer', {
      for: 'insert',
      to: 'knowledge_definer',
      withCheck: sql`true`,
    }),
  ],
);

/**
 * What each stage of an update request found (ADR-0031), in order: its stage, a fixed failure code
 * or what the controller decides on, its output as public rule data (the proposal, the code checks'
 * reasons, the validator's answers; never case data and never a provider's words), and the tokens
 * its model call used. At most four per request, one per position, so no row buys a third round.
 * `app_jobs` inserts them; `app_api` and `app_jobs` read them; nobody updates or deletes.
 */
export const updateStage = knowledge.table(
  'update_stage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => updateRequest.id),
    position: integer('position').notNull(),
    stage: text('stage', { enum: updateStages }).notNull(),
    failure: text('failure'),
    needsCorrection: boolean('needs_correction'),
    proposalValid: boolean('proposal_valid'),
    output: jsonb('output'),
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    /** Web searches the research model ran, which Anthropic bills apart from tokens. */
    webSearches: integer('web_searches'),
    at: timestamp('at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('update_stage_request_position_key').on(table.requestId, table.position),
    check('update_stage_position', sql`${table.position} BETWEEN 0 AND 3`),
    check('update_stage_stage', inList(table.stage, updateStages)),
    check(
      'update_stage_in_order',
      sql`${table.stage} = (ARRAY['research', 'validation', 'correction', 'final_validation'])[${table.position} + 1]`,
    ),
    check(
      'update_stage_failure_format',
      sql`${table.failure} IS NULL OR ${slugCode(table.failure)}`,
    ),
    check(
      'update_stage_outcome',
      sql`(${table.failure} IS NULL) = (${table.needsCorrection} IS NOT NULL AND ${table.proposalValid} IS NOT NULL)`,
    ),
    check(
      'update_stage_output_size',
      sql`${table.output} IS NULL OR octet_length(${table.output}::text) <= 2000000`,
    ),
    check('update_stage_model_format', sql`${table.model} IS NULL OR ${slugFormat(table.model)}`),
    check(
      'update_stage_tokens',
      sql`coalesce(${table.inputTokens}, 0) >= 0 AND coalesce(${table.outputTokens}, 0) >= 0
        AND coalesce(${table.cacheReadTokens}, 0) >= 0 AND coalesce(${table.cacheWriteTokens}, 0) >= 0
        AND coalesce(${table.webSearches}, 0) >= 0`,
    ),
    pgPolicy('update_stage_read', { for: 'select', to: ['app_api', 'app_jobs'], using: sql`true` }),
    pgPolicy('update_stage_insert', { for: 'insert', to: 'app_jobs', withCheck: sql`true` }),
  ],
);

/**
 * How an update request ended (ADR-0031): finished with its proposal, or failed with a fixed code
 * and none. The proposal is the checked version's content, its content hash, its cases and the
 * three lists; the same transaction stores the proposal as a route version that names the request,
 * which then reads as proposed (#460). One per request; `app_jobs` inserts it; `app_api` and `app_jobs` read it; nobody updates or
 * deletes.
 */
export const updateEnd = knowledge.table(
  'update_end',
  {
    requestId: uuid('request_id')
      .primaryKey()
      .references(() => updateRequest.id),
    failure: text('failure'),
    contentHash: text('content_hash'),
    proposal: jsonb('proposal'),
    at: timestamp('at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    check(
      'update_end_shape',
      sql`CASE WHEN ${table.failure} IS NULL
        THEN ${table.proposal} IS NOT NULL AND ${table.contentHash} ~ '^[0-9a-f]{64}$'
        ELSE ${slugCode(table.failure)} AND ${table.proposal} IS NULL AND ${table.contentHash} IS NULL END`,
    ),
    check(
      'update_end_proposal_size',
      sql`${table.proposal} IS NULL OR octet_length(${table.proposal}::text) <= 2000000`,
    ),
    pgPolicy('update_end_read', {
      for: 'select',
      to: ['app_api', 'app_jobs', 'knowledge_definer'],
      using: sql`true`,
    }),
    pgPolicy('update_end_insert', { for: 'insert', to: 'app_jobs', withCheck: sql`true` }),
  ],
);

/**
 * The validator's answers, kept until what they answered changes (spec #455 amendment): keyed by
 * the SHA-256 of the item's values, its verified quote, the text hash of the page the quote is on
 * and the validator model, so a new request reuses an answer and pays only for what changed; a
 * changed page or item makes a new key, and a prompt change never does. Public rule data only.
 * `app_jobs` inserts and reads them; nobody updates or deletes.
 */
export const ruleVerdict = knowledge.table(
  'rule_verdict',
  {
    cacheKey: text('cache_key').primaryKey(),
    verdict: text('verdict', { enum: ['supports', 'contradicts', 'cannot_tell'] }).notNull(),
    at: timestamp('at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    check('rule_verdict_cache_key_format', sql`${table.cacheKey} ~ '^[0-9a-f]{64}$'`),
    check(
      'rule_verdict_verdict',
      inList(table.verdict, ['supports', 'contradicts', 'cannot_tell']),
    ),
    pgPolicy('rule_verdict_read', { for: 'select', to: 'app_jobs', using: sql`true` }),
    pgPolicy('rule_verdict_insert', { for: 'insert', to: 'app_jobs', withCheck: sql`true` }),
  ],
);
