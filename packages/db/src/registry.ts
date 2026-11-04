/**
 * The personal-data registry (spec 0004 R7, ADR-0017): a lifecycle decision for every table in a
 * user schema. Account deletion and export are driven by it alone, and a guard test over the
 * catalog fails on any table it does not list.
 */

/** The pool that erases an entry: `app_auth` for the `auth` schema, `app_jobs` for the rest. */
export type ErasingPool = 'app_auth' | 'app_jobs';

/**
 * Whose rows these are: a column holding the account ID, or the entry the rows hang off, whose
 * erasure removes them through an `ON DELETE CASCADE` foreign key.
 */
export type Owner = { readonly column: string } | { readonly parent: string };

interface Exported {
  /** `schema.table`. */
  readonly table: string;
  /** The columns the account's export carries (spec 0004 R8); secrets and hashes stay out. */
  readonly export: readonly string[];
  /** The i18n key of the export's label for these rows. */
  readonly label: `dataExport.tables.${string}`;
}

export interface DeletedEntry extends Exported {
  readonly strategy: 'delete';
  readonly owner: Owner;
  readonly pool: ErasingPool;
}

/** Kept after erasure with identifiers only; purging needs its own ADR before the period ends. */
export interface RetainedEntry extends Exported {
  readonly strategy: 'retain';
  readonly owner: { readonly column: string };
  readonly reason: string;
  /** An ISO 8601 period, such as `P5Y`. */
  readonly period: `P${number}Y`;
}

export type RegistryEntry = DeletedEntry | RetainedEntry;

/**
 * A table whose rows no account owns. `none` holds no personal data. `until-expiry` holds some
 * only during a short ceremony, before an account exists or without naming one; account deletion
 * sweeps its expired rows (spec 0004 R9), so nothing outlives the erasure.
 */
export interface UnownedTable {
  readonly table: string;
  readonly personalData: 'none' | 'until-expiry';
  readonly reason: string;
}

export interface Registry {
  readonly entries: readonly RegistryEntry[];
  readonly unowned: readonly UnownedTable[];
}

const ownedByAccount = (column: string) => ({ column });

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
      owner: { parent: 'auth.passkey' },
      pool: 'app_auth',
      export: ['active_from', 'recovery'],
      label: 'dataExport.tables.passkeyWaits',
    },
    {
      table: 'auth.passkey_capability',
      strategy: 'delete',
      owner: { parent: 'auth.passkey' },
      pool: 'app_auth',
      export: ['prf_enabled'],
      label: 'dataExport.tables.passkeyCapabilities',
    },
    {
      table: 'auth.passkey_client',
      strategy: 'delete',
      owner: { parent: 'auth.passkey' },
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
      table: 'audit.event',
      strategy: 'retain',
      owner: ownedByAccount('subject_account_id'),
      reason:
        'The security record of what happened to the account, kept with identifiers and event codes only (ADR-0008).',
      period: 'P5Y',
      export: ['time', 'code'],
      label: 'dataExport.tables.securityHistory',
    },
  ],
  unowned: [
    {
      table: 'arca_migrations.journal',
      personalData: 'none',
      reason: "The migration runner's journal of applied migrations.",
    },
    {
      table: 'auth.rate_limit',
      personalData: 'none',
      reason: 'Request counters keyed by HMACs.',
    },
    {
      table: 'auth.setup',
      personalData: 'none',
      reason: 'Hashes of spent enrollment codes, kept so an emptied user table never revives one.',
    },
    {
      table: 'auth.outbox',
      personalData: 'until-expiry',
      reason:
        'Non-production email outbox, by recipient address, never written in production; rows expire after 7 days.',
    },
    {
      table: 'auth.registration_context',
      personalData: 'until-expiry',
      reason:
        'Single-use registration contexts with the address a link went to, read before any account exists; 30 minutes.',
    },
    {
      table: 'auth.verification',
      personalData: 'until-expiry',
      reason:
        "Better Auth's passkey ceremony state, whose value can hold the account's ID and name; minutes.",
    },
  ],
};
