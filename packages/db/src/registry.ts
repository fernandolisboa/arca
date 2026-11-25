/**
 * The personal-data registry (spec 0004 R7, ADR-0017): a lifecycle decision for every table in a
 * user schema. Account deletion and export are driven by it alone, and a guard test over the
 * catalog fails on any table it does not list.
 */

/** The pool that erases an entry: `app_auth` for the `auth` schema, `app_jobs` for the rest. */
export type ErasingPool = 'app_auth' | 'app_jobs';

/** A foreign key from an entry's `columns` to its parent's `parentColumns`, `ON DELETE CASCADE`. */
export interface ParentLink {
  readonly parent: string;
  readonly columns: readonly string[];
  readonly parentColumns: readonly string[];
}

/**
 * Whose rows these are: a non-null column holding the account ID; several such columns, when a
 * row belongs to each account it names (a link between two accounts); the entry the rows hang
 * off, whose erasure removes them through the cascade of a `ParentLink`; any of several parents,
 * when a row belongs to whoever owns either end (a relationship between two people); or the rows
 * of another entry that point at them, when a row belongs to the owners of the rows that reference
 * it and goes with the last of them (an asset and its owner rows), which a trigger does. A parent
 * or a referencing entry is itself owned by a column or by a parent, and the export joins through
 * the same foreign keys.
 */
export type Owner =
  | { readonly column: string }
  | { readonly anyColumn: readonly [string, ...string[]] }
  | ParentLink
  | { readonly anyParent: readonly [ParentLink, ParentLink, ...ParentLink[]] }
  | {
      readonly referencedBy: string;
      /** The referencing entry's columns, which name this entry's `columns`. */
      readonly referencingColumns: readonly string[];
      readonly columns: readonly string[];
    };

interface Exported {
  /** `schema.table`. */
  readonly table: string;
  /** The columns the account's export carries (spec 0004 R8); secrets and hashes stay out. */
  readonly export: readonly string[];
  /** The i18n key of the export's label for these rows. */
  readonly label: `dataExport.tables.${string}`;
  /**
   * A definer function, `schema.name(entry text) RETURNS SETOF jsonb`, that answers the account's
   * own rows of a table `app_api` may not read, with the `export` columns.
   */
  readonly exportedThrough?: string;
}

export interface DeletedEntry extends Exported {
  readonly strategy: 'delete';
  readonly owner: Owner;
  readonly pool: ErasingPool;
}

/**
 * Kept after erasure with identifiers only; purging needs its own ADR before the period ends.
 * `forever` is a record that must outlive every account, such as which rules are in use.
 */
export interface RetainedEntry extends Exported {
  readonly strategy: 'retain';
  readonly owner: { readonly column: string };
  readonly reason: string;
  /** An ISO 8601 period, such as `P5Y`, or `forever`. */
  readonly period: `P${number}Y` | 'forever';
  /**
   * Why a row may name no owner: such a row records nothing about a person, so neither erasure
   * nor export has to reach it. Without it, the owner column must not be null.
   */
  readonly ownerless?: string;
}

export type RegistryEntry = DeletedEntry | RetainedEntry;

/**
 * A table whose rows no account owns: `none` holds no personal data; `until-expiry` holds some,
 * or pseudonyms of it, only for a short time, in rows that name no owner column. Its rows end at
 * `expiresAt`, and account deletion sweeps the expired ones (spec 0004 R9), so they outlive an
 * erasure by at most their own lifetime.
 */
export type UnownedTable =
  | { readonly table: string; readonly personalData: 'none'; readonly reason: string }
  | {
      readonly table: string;
      readonly personalData: 'until-expiry';
      readonly expiresAt: string;
      readonly reason: string;
    };

export interface Registry {
  readonly entries: readonly RegistryEntry[];
  readonly unowned: readonly UnownedTable[];
}

/** The columns that name the rows' accounts; none for rows owned through other rows. */
export function ownerColumns(owner: Owner): readonly string[] {
  if ('column' in owner) return [owner.column];
  return 'anyColumn' in owner ? owner.anyColumn : [];
}

/** The foreign keys an owner reaches its rows' owners through; none for an owner column. */
export function parentLinks(owner: Owner): readonly ParentLink[] {
  if ('anyParent' in owner) return owner.anyParent;
  return 'parent' in owner ? [owner] : [];
}

const ownedByAccount = (column: string) => ({ column });

/** A case row that belongs to whoever keeps its person, and goes with the person. */
const keptPerson = (columns: readonly string[], parentColumns: readonly string[]): ParentLink => ({
  parent: 'cases.person',
  columns,
  parentColumns,
});

/** A row of an admin's correction request (ADR-0029), which goes with the request. */
const correctionRequest: ParentLink = {
  parent: 'knowledge.correction_request',
  columns: ['request_id'],
  parentColumns: ['id'],
};

export const registry: Registry = {
  entries: [
    {
      table: 'auth.user',
      strategy: 'delete',
      owner: ownedByAccount('id'),
      pool: 'app_auth',
      export: ['name', 'email', 'email_verified', 'created_at', 'last_sign_in_at', 'confirmed_at'],
      label: 'dataExport.tables.account',
    },
    {
      table: 'auth.account',
      strategy: 'delete',
      owner: ownedByAccount('user_id'),
      pool: 'app_auth',
      export: ['provider_id', 'created_at'],
      label: 'dataExport.tables.signInMethods',
    },
    {
      table: 'auth.session',
      strategy: 'delete',
      owner: ownedByAccount('user_id'),
      pool: 'app_auth',
      export: ['created_at', 'expires_at', 'device_browser', 'device_os'],
      label: 'dataExport.tables.sessions',
    },
    {
      table: 'auth.passkey',
      strategy: 'delete',
      owner: ownedByAccount('user_id'),
      pool: 'app_auth',
      export: ['name', 'device_type', 'backed_up', 'created_at'],
      label: 'dataExport.tables.passkeys',
    },
    {
      table: 'auth.passkey_activation',
      strategy: 'delete',
      owner: {
        parent: 'auth.passkey',
        columns: ['credential_id'],
        parentColumns: ['credential_id'],
      },
      pool: 'app_auth',
      export: ['active_from', 'recovery'],
      label: 'dataExport.tables.passkeyWaits',
    },
    {
      table: 'auth.passkey_capability',
      strategy: 'delete',
      owner: {
        parent: 'auth.passkey',
        columns: ['credential_id'],
        parentColumns: ['credential_id'],
      },
      pool: 'app_auth',
      export: ['prf_enabled'],
      label: 'dataExport.tables.passkeyCapabilities',
    },
    {
      table: 'auth.passkey_client',
      strategy: 'delete',
      owner: {
        parent: 'auth.passkey',
        columns: ['credential_id'],
        parentColumns: ['credential_id'],
      },
      pool: 'app_auth',
      export: ['browser', 'os', 'first_seen_at'],
      label: 'dataExport.tables.devices',
    },
    {
      table: 'auth.passkey_challenge',
      strategy: 'delete',
      owner: ownedByAccount('account_id'),
      pool: 'app_auth',
      export: ['expires_at'],
      label: 'dataExport.tables.passkeyChallenges',
    },
    {
      table: 'auth.recovery_code',
      strategy: 'delete',
      owner: ownedByAccount('account_id'),
      pool: 'app_auth',
      export: ['created_at', 'confirmed_at', 'provisional_until'],
      label: 'dataExport.tables.recoveryCode',
    },
    {
      table: 'auth.recovery_link',
      strategy: 'delete',
      owner: ownedByAccount('account_id'),
      pool: 'app_auth',
      export: ['expires_at', 'redeemed_at'],
      label: 'dataExport.tables.recoveryLinks',
    },
    {
      table: 'auth.recovery_lock',
      strategy: 'delete',
      owner: ownedByAccount('account_id'),
      pool: 'app_auth',
      export: ['failures', 'locked_until'],
      label: 'dataExport.tables.recoveryAttempts',
    },
    {
      table: 'auth.step_up',
      strategy: 'delete',
      owner: ownedByAccount('account_id'),
      pool: 'app_auth',
      export: ['purpose', 'verified_at', 'consumed_at'],
      label: 'dataExport.tables.stepUps',
    },
    {
      table: 'auth.step_up_challenge',
      strategy: 'delete',
      owner: ownedByAccount('account_id'),
      pool: 'app_auth',
      export: ['purpose', 'expires_at'],
      label: 'dataExport.tables.stepUpChallenges',
    },
    {
      // The invitee's address is the inviter's record; the invitee's own erasure removes the row
      // too, through the cascade on `accepted_account_id`.
      table: 'auth.invite',
      strategy: 'delete',
      owner: ownedByAccount('inviter_id'),
      pool: 'app_auth',
      export: ['email', 'created_at', 'expires_at', 'accepted_at'],
      label: 'dataExport.tables.invites',
    },
    {
      table: 'account.link',
      strategy: 'delete',
      owner: { anyColumn: ['inviter_id', 'invitee_id'] },
      pool: 'app_jobs',
      export: ['created_at'],
      label: 'dataExport.tables.accountLinks',
    },
    {
      table: 'vault.document',
      strategy: 'delete',
      owner: ownedByAccount('owner_id'),
      pool: 'app_jobs',
      export: ['type_key', 'size', 'created_at', 'confirmed_at'],
      label: 'dataExport.tables.vaultDocuments',
    },
    {
      table: 'vault.document_recipient',
      strategy: 'delete',
      owner: ownedByAccount('recipient_id'),
      pool: 'app_jobs',
      export: ['created_at'],
      label: 'dataExport.tables.vaultDocumentsSharedWithYou',
    },
    {
      table: 'vault.document_country',
      strategy: 'delete',
      owner: ownedByAccount('owner_id'),
      pool: 'app_jobs',
      export: ['country', 'created_at'],
      label: 'dataExport.tables.vaultDocumentCountries',
    },
    {
      table: 'vault.document_replacement',
      strategy: 'delete',
      owner: ownedByAccount('owner_id'),
      pool: 'app_jobs',
      export: ['size', 'created_at'],
      label: 'dataExport.tables.vaultDocumentReplacements',
    },
    {
      table: 'vault.discarded_object',
      strategy: 'delete',
      owner: ownedByAccount('owner_id'),
      pool: 'app_jobs',
      export: ['discarded_at'],
      label: 'dataExport.tables.vaultDiscardedObjects',
    },
    {
      table: 'vault.envelope',
      strategy: 'delete',
      owner: ownedByAccount('account_id'),
      pool: 'app_jobs',
      export: ['kind', 'created_at'],
      label: 'dataExport.tables.vaultEnvelopes',
    },
    {
      table: 'vault.sharing_state',
      strategy: 'delete',
      owner: ownedByAccount('account_id'),
      pool: 'app_jobs',
      export: ['version', 'updated_at'],
      label: 'dataExport.tables.vaultSharingState',
    },
    {
      table: 'vault.recipient',
      strategy: 'delete',
      owner: ownedByAccount('account_id'),
      pool: 'app_jobs',
      export: ['recipient', 'created_at', 'rotated_at'],
      label: 'dataExport.tables.vaultRecipients',
    },
    {
      table: 'notification.delivery',
      strategy: 'delete',
      owner: ownedByAccount('account_id'),
      pool: 'app_jobs',
      export: ['delivered_at'],
      label: 'dataExport.tables.notificationDeliveries',
    },
    {
      table: 'notification.message',
      strategy: 'delete',
      owner: ownedByAccount('account_id'),
      pool: 'app_jobs',
      export: ['code', 'created_at'],
      label: 'dataExport.tables.notificationMessages',
    },
    {
      table: 'notification.channel',
      strategy: 'delete',
      owner: ownedByAccount('account_id'),
      pool: 'app_jobs',
      export: ['kind', 'browser', 'os', 'created_at', 'last_success_at'],
      label: 'dataExport.tables.notificationChannels',
    },
    {
      table: 'cases.member',
      strategy: 'delete',
      owner: ownedByAccount('account_id'),
      pool: 'app_jobs',
      export: ['joined_at'],
      label: 'dataExport.tables.caseMembership',
    },
    {
      table: 'cases.person',
      strategy: 'delete',
      owner: ownedByAccount('keeper_account_id'),
      pool: 'app_jobs',
      export: ['display_name', 'case_member', 'created_at'],
      label: 'dataExport.tables.casePeople',
    },
    {
      table: 'cases.person_profile',
      strategy: 'delete',
      owner: keptPerson(['person_id'], ['id']),
      pool: 'app_jobs',
      export: ['facts', 'dependence_answered', 'updated_at'],
      label: 'dataExport.tables.caseProfiles',
    },
    {
      table: 'cases.person_finances',
      strategy: 'delete',
      owner: keptPerson(['person_id'], ['id']),
      pool: 'app_jobs',
      export: ['incomes', 'assets_recorded_in_full', 'updated_at'],
      label: 'dataExport.tables.caseFinances',
    },
    {
      table: 'cases.dependence',
      strategy: 'delete',
      owner: keptPerson(['person_id', 'case_id'], ['id', 'case_id']),
      pool: 'app_jobs',
      export: ['created_at'],
      label: 'dataExport.tables.caseDependence',
    },
    {
      table: 'cases.asset_owner',
      strategy: 'delete',
      owner: keptPerson(['person_id', 'case_id'], ['id', 'case_id']),
      pool: 'app_jobs',
      export: ['share', 'confirmed', 'created_at'],
      label: 'dataExport.tables.caseAssetShares',
    },
    {
      table: 'cases.asset',
      strategy: 'delete',
      owner: {
        referencedBy: 'cases.asset_owner',
        referencingColumns: ['asset_id', 'case_id'],
        columns: ['id', 'case_id'],
      },
      pool: 'app_jobs',
      export: [
        'kind',
        'value_amount',
        'value_currency',
        'valued_at',
        'liquid',
        'sold',
        'country',
        'operating_since',
        'employees',
        'created_at',
      ],
      label: 'dataExport.tables.caseAssets',
    },
    {
      table: 'cases.relationship',
      strategy: 'delete',
      owner: {
        anyParent: [
          keptPerson(['from_person_id', 'case_id'], ['id', 'case_id']),
          keptPerson(['to_person_id', 'case_id'], ['id', 'case_id']),
        ],
      },
      pool: 'app_jobs',
      export: ['kind', 'details', 'created_at'],
      label: 'dataExport.tables.caseRelationships',
    },
    {
      table: 'cases.share',
      strategy: 'delete',
      owner: keptPerson(['person_id', 'case_id'], ['id', 'case_id']),
      pool: 'app_jobs',
      export: ['scope', 'created_at'],
      label: 'dataExport.tables.caseShares',
    },
    {
      table: 'cases.rule_report',
      strategy: 'delete',
      owner: ownedByAccount('reporter_account_id'),
      pool: 'app_jobs',
      export: [
        'route_id',
        'version_number',
        'requirement_id',
        'reason',
        'note',
        'state',
        'created_at',
      ],
      label: 'dataExport.tables.ruleReports',
    },
    {
      table: 'cases.plan_move',
      strategy: 'delete',
      owner: keptPerson(['principal_id', 'case_id'], ['id', 'case_id']),
      pool: 'app_jobs',
      export: ['stage', 'route_id', 'created_at'],
      label: 'dataExport.tables.planMoves',
    },
    {
      table: 'cases.plan_move_dependent',
      strategy: 'delete',
      owner: keptPerson(['person_id', 'case_id'], ['id', 'case_id']),
      pool: 'app_jobs',
      export: ['created_at'],
      label: 'dataExport.tables.planMoveDependents',
    },
    {
      table: 'cases.comparison_preferences',
      strategy: 'delete',
      owner: ownedByAccount('account_id'),
      pool: 'app_jobs',
      export: ['preferences', 'updated_at'],
      label: 'dataExport.tables.comparisonPreferences',
    },
    {
      table: 'knowledge.correction_request',
      strategy: 'delete',
      owner: ownedByAccount('author_account_id'),
      pool: 'app_jobs',
      export: [
        'route_id',
        'version_number',
        'country_code',
        'item_kind',
        'item_key',
        'note',
        'created_at',
      ],
      label: 'dataExport.tables.correctionRequests',
      exportedThrough: 'knowledge.own_correction_request_rows',
    },
    {
      table: 'knowledge.correction_source',
      strategy: 'delete',
      owner: correctionRequest,
      pool: 'app_jobs',
      export: ['position', 'kind', 'url', 'text'],
      label: 'dataExport.tables.correctionSources',
      exportedThrough: 'knowledge.own_correction_rows',
    },
    {
      table: 'knowledge.correction_event',
      strategy: 'delete',
      owner: correctionRequest,
      pool: 'app_jobs',
      export: ['kind', 'at'],
      label: 'dataExport.tables.correctionEvents',
      exportedThrough: 'knowledge.own_correction_rows',
    },
    {
      // After the requests, whose sources name these uploads; their objects go first (erasure).
      table: 'knowledge.correction_upload',
      strategy: 'delete',
      owner: ownedByAccount('author_account_id'),
      pool: 'app_jobs',
      export: ['media_type', 'size', 'created_at'],
      label: 'dataExport.tables.correctionUploads',
      exportedThrough: 'knowledge.own_correction_upload_rows',
    },
    {
      table: 'audit.event',
      strategy: 'retain',
      owner: ownedByAccount('subject_account_id'),
      reason:
        'The security record of what happened to the account, kept with identifiers and event codes only (ADR-0008).',
      period: 'P5Y',
      export: ['time', 'code'],
      label: 'dataExport.tables.securityHistory',
    },
    {
      table: 'knowledge.decision',
      strategy: 'retain',
      owner: ownedByAccount('approver_account_id'),
      reason:
        'The record of which rule and comparison versions are in use and who decided, with its proof (for decisions made before ADR-0027, the step-up assertion); it holds no other personal data (spec 0007, R7; ADR-0026, ADR-0027).',
      period: 'forever',
      ownerless:
        'A session review activation is stored by a migration and names no account, assertion or key: the decision_author check ties a missing approver to the session_review proof (ADR-0032).',
      export: ['decided_at', 'kind', 'subject_kind', 'route_id', 'comparison_id', 'version_number'],
      label: 'dataExport.tables.knowledgeDecisions',
    },
    {
      table: 'knowledge.admin_grant',
      strategy: 'retain',
      owner: ownedByAccount('grantee_account_id'),
      reason:
        'The history of the admin role, which decisions rely on: who gave or took away the role from whom and when, with account IDs only (ADR-0027).',
      period: 'forever',
      export: ['kind', 'at'],
      label: 'dataExport.tables.adminGrants',
    },
    {
      table: 'knowledge.corrector_key',
      strategy: 'retain',
      owner: ownedByAccount('actor_account_id'),
      reason:
        "The record of who made or revoked the retired corrector key and when, which the corrector run's answers name, with account IDs and key digests only (ADR-0029); kept read-only as history since ADR-0031.",
      period: 'forever',
      export: ['kind', 'at'],
      label: 'dataExport.tables.correctorKeys',
      exportedThrough: 'knowledge.own_corrector_key_rows',
    },
    {
      table: 'knowledge.ai_key',
      strategy: 'retain',
      owner: ownedByAccount('actor_account_id'),
      reason:
        "The record of who set or removed an AI provider's API key and when (ADR-0031), with the key encrypted under a key-encryption key that lives outside the database; it is the settings' history, not personal data beyond the actor's account ID.",
      period: 'forever',
      export: ['provider', 'kind', 'at'],
      label: 'dataExport.tables.aiKeys',
    },
  ],
  unowned: [
    {
      table: 'knowledge.ai_stage_setting',
      personalData: 'none',
      reason:
        'The model and effort chosen for a stage of an update request (ADR-0031); who chose is in the audit log, so it names no account.',
    },
    {
      table: 'knowledge.check_start',
      personalData: 'none',
      reason:
        'A start of the retired independent check of a route version (ADR-0027), kept read-only as history since ADR-0031: its route, number and time only; it names no account.',
    },
    {
      table: 'knowledge.check_progress',
      personalData: 'none',
      reason:
        'What a start of the retired independent check recorded as it ran (ADR-0027), kept read-only as history since ADR-0031: counts, cited official URLs, item keys with their verified status, model token counts and fixed codes; it names no account.',
    },
    {
      table: 'knowledge.independent_check',
      personalData: 'none',
      reason:
        "The retired independent check's report on a route version's public content against its official sources (ADR-0027), kept read-only as history since ADR-0031, with model output and a fetch log of official URLs; it names no account.",
    },
    {
      table: 'knowledge.rule_summary',
      personalData: 'none',
      reason:
        "A model's summary of a route version's public content for the admin (ADR-0025), keyed by the version's hash, prompt and model; it names no account.",
    },
    {
      table: 'knowledge.route_version',
      personalData: 'none',
      reason:
        'A route version (ADR-0031): public rule content, its content hash and its synthetic cases; it names no account.',
    },
    {
      table: 'knowledge.country_set',
      personalData: 'none',
      reason:
        'A country set (ADR-0031): public rule content and its content hash; it names no account.',
    },
    {
      table: 'knowledge.official_domain_list',
      personalData: 'none',
      reason:
        'An official-domain list (ADR-0031): the hosts of public bodies and its content hash; it names no account.',
    },
    {
      table: 'knowledge.update_request',
      personalData: 'none',
      reason:
        "An update request (ADR-0031): the route and the version it updates, or for a new route the country, the visa or entry type an admin typed, the admin's official links and the country's approved lists, and when it was asked for; the audit log names who asked, so it names no account.",
    },
    {
      table: 'knowledge.update_stage',
      personalData: 'none',
      reason:
        "A stage of an update request (ADR-0031): the proposal as public rule data, code's reasons, the validator's answers, fixed codes and token counts; it names no account.",
    },
    {
      table: 'knowledge.update_end',
      personalData: 'none',
      reason:
        "How an update request ended (ADR-0031): a fixed code, or the proposed version's public content, hash, cases and the three lists; it names no account.",
    },
    {
      table: 'knowledge.version_edit',
      personalData: 'none',
      reason:
        "An admin's hand edit of a route version (ADR-0031): the item, the official page and the quote, public rule data; the audit log names who edited, so it names no account.",
    },
    {
      table: 'knowledge.rule_verdict',
      personalData: 'none',
      reason:
        "The validator's answer about a rule item's verified quote, keyed by a hash of the item, the quote, the page text and the model (ADR-0031); it names no account.",
    },
    {
      table: 'cases.case_file',
      personalData: 'none',
      reason: 'A case: its ID and creation time only; it ends with its last member.',
    },
    {
      table: 'arca_migrations.journal',
      personalData: 'none',
      reason: "The migration runner's journal of applied migrations.",
    },
    {
      table: 'auth.erased_account',
      personalData: 'none',
      reason:
        'IDs of erased accounts whose audit event is still owed; the audit trail keeps the same IDs.',
    },
    {
      table: 'auth.setup',
      personalData: 'none',
      reason: 'Hashes of spent enrollment codes, kept so an emptied user table never revives one.',
    },
    {
      table: 'auth.rate_limit',
      personalData: 'until-expiry',
      expiresAt: 'expires_at',
      reason:
        "Request counters keyed by the server's HMACs of addresses or account IDs; windows of a day at most.",
    },
    {
      table: 'auth.outbox',
      personalData: 'until-expiry',
      expiresAt: 'expires_at',
      reason:
        'Non-production email outbox, by recipient address, never written in production; 7 days.',
    },
    {
      table: 'auth.registration_context',
      personalData: 'until-expiry',
      expiresAt: 'expires_at',
      reason:
        'Single-use registration contexts with the address a link went to, read before any account exists; 30 minutes.',
    },
    {
      table: 'auth.verification',
      personalData: 'until-expiry',
      expiresAt: 'expires_at',
      reason:
        "Better Auth's passkey ceremony state, whose value holds a registration context's ID and address, or a signed-in account's ID; minutes.",
    },
  ],
};
