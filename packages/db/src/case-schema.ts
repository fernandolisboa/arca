import { sql, type SQL } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The case (spec 0007, R1): who is in it, the people it describes, their facts and who may see
 * them. Every table is under forced row-level security for `app_api`, keyed on the request
 * identity. People and relationships are visible to the case's members; a person's profile and
 * finances only to the account that keeps the person and to whom it shared them with. Every
 * reference from one person to another is a row whose foreign keys cascade, never an ID inside
 * JSON. Writes that cross keepers, and the checks that span rows a writer may not see, run in the
 * `SECURITY DEFINER` functions of the `cases_definer` role, which cannot log in.
 */
export const cases = pgSchema('cases');

const identity = sql`nullif(current_setting('app.account_id', true), '')::uuid`;
const isIdentity = (accountId: unknown): SQL => sql`${accountId} = ${identity}`;

/** The one reviewed membership check; a policy on `member` cannot query `member` itself. */
const isMember = (caseId: unknown): SQL => sql`cases.is_member(${caseId})`;

/** Whether the identity keeps the person. */
const keeps = (personId: unknown): SQL =>
  sql`EXISTS (SELECT 1 FROM ${person} WHERE ${person.id} = ${personId} AND ${isIdentity(person.keeperAccountId)})`;

/** Whether the person's keeper shared that scope of the person with the identity. */
const sharedWith = (personId: unknown, scope: 'profile' | 'finances'): SQL =>
  sql`EXISTS (SELECT 1 FROM ${share} WHERE ${share.personId} = ${personId} AND ${isIdentity(share.granteeAccountId)} AND ${share.scope} = ${sql.raw(`'${scope}'`)})`;

/** A JSON value of the given type and at most `bytes` long. */
const jsonShape = (name: string, column: unknown, type: 'object' | 'array', bytes: number) =>
  check(
    name,
    sql`jsonb_typeof(${column}) = ${sql.raw(`'${type}'`)} AND octet_length(${column}::text) <= ${sql.raw(String(bytes))}`,
  );

/** `app_jobs` erases the identity's own rows (spec 0004 R9); the registry guard checks the form. */
function erasedByJobs(table: string, accountId: unknown) {
  return [
    pgPolicy(`${table}_select_own_by_jobs`, {
      for: 'select',
      to: 'app_jobs',
      using: isIdentity(accountId),
    }),
    pgPolicy(`${table}_delete_own_by_jobs`, {
      for: 'delete',
      to: 'app_jobs',
      using: isIdentity(accountId),
    }),
  ];
}

/**
 * `cases_definer`'s access to a table: its functions name every row they touch, and check the
 * identity themselves, so its policies admit every row.
 */
function byDefiner(
  table: string,
  commands: readonly ('select' | 'insert' | 'update' | 'delete')[],
) {
  return commands.map((command) =>
    pgPolicy(`${table}_${command}_by_definer`, {
      for: command,
      to: 'cases_definer',
      ...(command === 'insert' ? {} : { using: sql`true` }),
      ...(command === 'insert' || command === 'update' ? { withCheck: sql`true` } : {}),
    }),
  );
}

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** A case: its ID and when it began. It holds no personal data and ends with its last member. */
export const caseFile = cases.table(
  'case_file',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: createdAt(),
  },
  (table) => [
    pgPolicy('case_file_select_member', {
      for: 'select',
      to: 'app_api',
      using: isMember(table.id),
    }),
    ...byDefiner('case_file', ['select', 'insert', 'delete']),
  ],
);

/** An account in a case; one case per account in this slice. */
export const member = cases.table(
  'member',
  {
    accountId: uuid('account_id').primaryKey(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => caseFile.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('member_case_id_account_id_key').on(table.caseId, table.accountId),
    pgPolicy('member_select_member', {
      for: 'select',
      to: 'app_api',
      using: isMember(table.caseId),
    }),
    // A member leaves the case by deleting their own row; the cascades take what they keep.
    pgPolicy('member_delete_self', {
      for: 'delete',
      to: 'app_api',
      using: isIdentity(table.accountId),
    }),
    // `is_member` names the identity itself; the empty-case cleanup needs every member of a case.
    ...byDefiner('member', ['select', 'insert']),
    ...erasedByJobs('member', table.accountId),
  ],
);

/**
 * Someone the case describes: a member, or a relative outside it such as a grandparent. The keeper
 * is a member of the same case, so a member who leaves takes the people they keep with them.
 */
export const person = cases.table(
  'person',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => caseFile.id, { onDelete: 'cascade' }),
    keeperAccountId: uuid('keeper_account_id').notNull(),
    /** The person's own account, when they have one; they then keep themselves. */
    accountId: uuid('account_id').unique('person_account_id_key'),
    displayName: text('display_name').notNull(),
    /** A member of the case, whom results are computed for, or a relative outside it. */
    caseMember: boolean('case_member').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'person_keeper_fkey',
      columns: [table.caseId, table.keeperAccountId],
      foreignColumns: [member.caseId, member.accountId],
    }).onDelete('cascade'),
    unique('person_id_case_id_key').on(table.id, table.caseId),
    index('person_case_id_idx').on(table.caseId),
    index('person_keeper_account_id_idx').on(table.keeperAccountId),
    check(
      'person_display_name_length',
      sql`char_length(${table.displayName}) BETWEEN 1 AND 80 AND ${table.displayName} = btrim(${table.displayName})`,
    ),
    check(
      'person_keeps_own_account',
      sql`${table.accountId} IS NULL OR (${table.accountId} = ${table.keeperAccountId} AND ${table.caseMember})`,
    ),
    pgPolicy('person_select_member', {
      for: 'select',
      to: 'app_api',
      using: isMember(table.caseId),
    }),
    // A person with an account joins through `cases_definer`; a keeper adds only people without one.
    pgPolicy('person_insert_keeper', {
      for: 'insert',
      to: 'app_api',
      withCheck: sql`${isIdentity(table.keeperAccountId)} AND ${table.accountId} IS NULL`,
    }),
    pgPolicy('person_update_keeper', {
      for: 'update',
      to: 'app_api',
      using: isIdentity(table.keeperAccountId),
      withCheck: isIdentity(table.keeperAccountId),
    }),
    // A member's own person goes only when the member leaves, by deleting their member row.
    pgPolicy('person_delete_keeper', {
      for: 'delete',
      to: 'app_api',
      using: sql`${isIdentity(table.keeperAccountId)} AND ${table.accountId} IS NULL`,
    }),
    ...byDefiner('person', ['select', 'insert', 'update']),
    ...erasedByJobs('person', table.keeperAccountId),
  ],
);

/** The person, in the same case as the row; deleting the person deletes the row. */
const personRow = (columns: [AnyPgColumn, AnyPgColumn], name: string) =>
  foreignKey({ name, columns, foreignColumns: [person.id, person.caseId] }).onDelete('cascade');

/**
 * A person's facts (the domain `personSchema` without incomes, dependence and the assets marker),
 * as the storage schema in `packages/domain` validates them, and whether dependence was answered.
 */
export const personProfile = cases.table(
  'person_profile',
  {
    personId: uuid('person_id')
      .primaryKey()
      .references(() => person.id, { onDelete: 'cascade' }),
    facts: jsonb('facts').notNull(),
    dependenceAnswered: boolean('dependence_answered').notNull().default(false),
    updatedAt: updatedAt(),
  },
  (table) => [
    jsonShape('person_profile_facts_shape', table.facts, 'object', 32768),
    pgPolicy('person_profile_select_keeper_or_shared', {
      for: 'select',
      to: 'app_api',
      using: sql`${keeps(table.personId)} OR ${sharedWith(table.personId, 'profile')}`,
    }),
    ...keeperWrites('person_profile', table.personId, ['insert', 'update', 'delete']),
  ],
);

/** A person's incomes (absent when unknown) and whether their assets are recorded in full. */
export const personFinances = cases.table(
  'person_finances',
  {
    personId: uuid('person_id')
      .primaryKey()
      .references(() => person.id, { onDelete: 'cascade' }),
    incomes: jsonb('incomes'),
    assetsRecordedInFull: boolean('assets_recorded_in_full').notNull().default(false),
    updatedAt: updatedAt(),
  },
  (table) => [
    jsonShape('person_finances_incomes_shape', table.incomes, 'array', 8192),
    pgPolicy('person_finances_select_keeper_or_shared', {
      for: 'select',
      to: 'app_api',
      using: sql`${keeps(table.personId)} OR ${sharedWith(table.personId, 'finances')}`,
    }),
    ...keeperWrites('person_finances', table.personId, ['insert', 'update', 'delete']),
  ],
);

/** One `app_api` policy per command, each holding only when `allowed` does. */
function writePolicies(
  table: string,
  allowed: SQL,
  commands: readonly ('insert' | 'update' | 'delete')[],
) {
  return commands.map((command) =>
    pgPolicy(`${table}_${command}_keeper`, {
      for: command,
      to: 'app_api',
      ...(command === 'insert' ? { withCheck: allowed } : { using: allowed }),
      ...(command === 'update' ? { withCheck: allowed } : {}),
    }),
  );
}

/** Writes by the keeper of the row's person only. */
function keeperWrites(
  table: string,
  personId: unknown,
  commands: readonly ('insert' | 'update' | 'delete')[],
) {
  return writePolicies(table, keeps(personId), commands);
}

/** A person depends financially on another person of the same case. */
export const dependence = cases.table(
  'dependence',
  {
    caseId: uuid('case_id').notNull(),
    personId: uuid('person_id').notNull(),
    dependsOnId: uuid('depends_on_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ name: 'dependence_pkey', columns: [table.personId, table.dependsOnId] }),
    personRow([table.personId, table.caseId], 'dependence_person_fkey'),
    personRow([table.dependsOnId, table.caseId], 'dependence_depends_on_fkey'),
    index('dependence_depends_on_id_idx').on(table.dependsOnId),
    check('dependence_two_people', sql`${table.personId} <> ${table.dependsOnId}`),
    pgPolicy('dependence_select_keeper_or_shared', {
      for: 'select',
      to: 'app_api',
      using: sql`${keeps(table.personId)} OR ${sharedWith(table.personId, 'profile')}`,
    }),
    ...keeperWrites('dependence', table.personId, ['insert', 'delete']),
  ],
);

export const assetKinds = [
  'cash',
  'investment',
  'real_estate',
  'business',
  'retirement',
  'vehicle',
  'other',
] as const;

/**
 * An asset of one or more people of the case. It is visible with any owner row the reader sees,
 * written by the keeper of a confirmed owner, and deleted, with any pending owner rows, when its
 * last confirmed owner row goes. `cases_definer` creates it together with its first owner row.
 */
export const asset = cases.table(
  'asset',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => caseFile.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    valueAmount: bigint('value_amount', { mode: 'bigint' }).notNull(),
    valueCurrency: text('value_currency').notNull(),
    valuedAt: date('valued_at').notNull(),
    liquid: boolean('liquid'),
    /** A date, partial or whole, or `none`; absent when unknown. */
    sold: text('sold'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('asset_id_case_id_key').on(table.id, table.caseId),
    index('asset_case_id_idx').on(table.caseId),
    check(
      'asset_kind',
      sql`${table.kind} IN (${sql.raw(assetKinds.map((kind) => `'${kind}'`).join(', '))})`,
    ),
    check('asset_value_amount', sql`${table.valueAmount} >= 0`),
    check('asset_value_currency', sql`${table.valueCurrency} ~ '^[A-Z]{3}$'`),
    check(
      'asset_sold',
      sql`${table.sold} = 'none' OR ${table.sold} ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$'`,
    ),
    pgPolicy('asset_select_owner_visible', {
      for: 'select',
      to: 'app_api',
      using: sql`EXISTS (SELECT 1 FROM ${ownerRows} WHERE ${ownerRow('asset_id')} = ${table.id})`,
    }),
    pgPolicy('asset_update_confirmed_keeper', {
      for: 'update',
      to: 'app_api',
      using: keepsConfirmedOwner(table.id),
      withCheck: keepsConfirmedOwner(table.id),
    }),
    pgPolicy('asset_delete_confirmed_keeper', {
      for: 'delete',
      to: 'app_api',
      using: keepsConfirmedOwner(table.id),
    }),
    ...byDefiner('asset', ['select', 'insert', 'delete']),
  ],
);

// `asset_owner` refers to `asset`, so `asset`'s policies name it in SQL rather than by its table
// object, which TypeScript cannot type while the two definitions refer to each other.
const ownerRows = sql.raw('"cases"."asset_owner"');
const ownerRow = (column: 'asset_id' | 'person_id' | 'confirmed') =>
  sql.raw(`"cases"."asset_owner"."${column}"`);

/** Whether the identity keeps a confirmed owner of the asset. */
function keepsConfirmedOwner(assetId: unknown): SQL {
  return sql`EXISTS (SELECT 1 FROM ${ownerRows} WHERE ${ownerRow('asset_id')} = ${assetId} AND ${ownerRow('confirmed')} AND ${keeps(ownerRow('person_id'))})`;
}

/**
 * A person's share of an asset. Another keeper may name the person as a co-owner, which leaves the
 * row pending until the person's keeper confirms it; the engine counts confirmed rows only.
 */
export const assetOwner = cases.table(
  'asset_owner',
  {
    caseId: uuid('case_id').notNull(),
    assetId: uuid('asset_id').notNull(),
    personId: uuid('person_id').notNull(),
    share: numeric('share', { precision: 7, scale: 6 }).notNull(),
    confirmed: boolean('confirmed').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ name: 'asset_owner_pkey', columns: [table.assetId, table.personId] }),
    foreignKey({
      name: 'asset_owner_asset_fkey',
      columns: [table.assetId, table.caseId],
      foreignColumns: [asset.id, asset.caseId],
    }).onDelete('cascade'),
    personRow([table.personId, table.caseId], 'asset_owner_person_fkey'),
    index('asset_owner_person_id_idx').on(table.personId),
    check('asset_owner_share', sql`${table.share} > 0 AND ${table.share} <= 1`),
    pgPolicy('asset_owner_select_keeper_or_shared', {
      for: 'select',
      to: 'app_api',
      using: sql`${keeps(table.personId)} OR ${sharedWith(table.personId, 'finances')}`,
    }),
    // The keeper confirms a pending row; adding rows and changing shares go through the definer.
    pgPolicy('asset_owner_update_keeper', {
      for: 'update',
      to: 'app_api',
      using: keeps(table.personId),
      withCheck: sql`${keeps(table.personId)} AND ${table.confirmed}`,
    }),
    pgPolicy('asset_owner_delete_keeper', {
      for: 'delete',
      to: 'app_api',
      using: keeps(table.personId),
    }),
    ...byDefiner('asset_owner', ['select', 'insert', 'update']),
  ],
);

export const relationshipKinds = ['spouse', 'partner', 'parent'] as const;

/**
 * One edge of the domain `relationshipSchema`. For `parent`, `from` is the parent and `to` the
 * child; a couple edge has no direction. The edge's dates and details are in `details`.
 */
export const relationship = cases.table(
  'relationship',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id').notNull(),
    kind: text('kind').notNull(),
    fromPersonId: uuid('from_person_id').notNull(),
    toPersonId: uuid('to_person_id').notNull(),
    details: jsonb('details')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (table) => [
    personRow([table.fromPersonId, table.caseId], 'relationship_from_person_fkey'),
    personRow([table.toPersonId, table.caseId], 'relationship_to_person_fkey'),
    index('relationship_case_id_idx').on(table.caseId),
    index('relationship_from_person_id_idx').on(table.fromPersonId),
    index('relationship_to_person_id_idx').on(table.toPersonId),
    check(
      'relationship_kind',
      sql`${table.kind} IN (${sql.raw(relationshipKinds.map((kind) => `'${kind}'`).join(', '))})`,
    ),
    check('relationship_two_people', sql`${table.fromPersonId} <> ${table.toPersonId}`),
    jsonShape('relationship_details_shape', table.details, 'object', 1024),
    pgPolicy('relationship_select_member', {
      for: 'select',
      to: 'app_api',
      using: isMember(table.caseId),
    }),
    ...writePolicies(
      'relationship',
      sql`${keeps(table.fromPersonId)} OR ${keeps(table.toPersonId)}`,
      ['insert', 'update', 'delete'],
    ),
  ],
);

export const shareScopes = ['profile', 'finances'] as const;

/** The keeper lets a member of the case see a person's profile or finances. */
export const share = cases.table(
  'share',
  {
    caseId: uuid('case_id').notNull(),
    personId: uuid('person_id').notNull(),
    granteeAccountId: uuid('grantee_account_id').notNull(),
    scope: text('scope').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      name: 'share_pkey',
      columns: [table.personId, table.granteeAccountId, table.scope],
    }),
    personRow([table.personId, table.caseId], 'share_person_fkey'),
    // A member who leaves loses every share at once.
    foreignKey({
      name: 'share_grantee_fkey',
      columns: [table.caseId, table.granteeAccountId],
      foreignColumns: [member.caseId, member.accountId],
    }).onDelete('cascade'),
    index('share_grantee_account_id_idx').on(table.granteeAccountId),
    check(
      'share_scope',
      sql`${table.scope} IN (${sql.raw(shareScopes.map((scope) => `'${scope}'`).join(', '))})`,
    ),
    pgPolicy('share_select_keeper_or_grantee', {
      for: 'select',
      to: 'app_api',
      using: sql`${keeps(table.personId)} OR ${isIdentity(table.granteeAccountId)}`,
    }),
    ...keeperWrites('share', table.personId, ['insert', 'delete']),
    // A hand-over drops the person's shares, so the new keeper decides who sees their data.
    ...byDefiner('share', ['select', 'delete']),
  ],
);

export const ruleReportReasons = [
  'outdated',
  'wrong_amount',
  'wrong_condition',
  'source_mismatch',
  'other',
] as const;

const ruleReportStates = ['open', 'closed'] as const;

const inList = (column: unknown, values: readonly string[]) =>
  sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;

/**
 * A member's report that a requirement shown in their results may be wrong (spec 0007, R8). Only
 * the reporter sees it; approvers see open reports counted per requirement through a definer
 * function that returns no note, case or reporter. Deleted with the reporter's membership, or 365
 * days after it was made.
 */
export const ruleReport = cases.table(
  'rule_report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id').notNull(),
    reporterAccountId: uuid('reporter_account_id').notNull(),
    routeId: text('route_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    requirementId: text('requirement_id').notNull(),
    reason: text('reason').notNull(),
    note: text('note'),
    state: text('state').notNull().default('open'),
    createdAt: createdAt(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    // A member who leaves takes their reports with them.
    foreignKey({
      name: 'rule_report_reporter_fkey',
      columns: [table.caseId, table.reporterAccountId],
      foreignColumns: [member.caseId, member.accountId],
    }).onDelete('cascade'),
    index('rule_report_reporter_account_id_idx').on(table.reporterAccountId),
    index('rule_report_open_idx')
      .on(table.routeId, table.versionNumber, table.requirementId)
      .where(sql`${table.state} = 'open'`),
    check('rule_report_reason', inList(table.reason, ruleReportReasons)),
    check('rule_report_state', inList(table.state, ruleReportStates)),
    check(
      'rule_report_closed_at',
      sql`(${table.state} = 'closed') = (${table.closedAt} IS NOT NULL)`,
    ),
    check('rule_report_note_length', sql`char_length(${table.note}) BETWEEN 1 AND 500`),
    check(
      'rule_report_route_id_format',
      sql`${table.routeId} ~ '^[a-z]{2}-[a-z0-9][a-z0-9-]{0,62}$'`,
    ),
    check('rule_report_version_number_positive', sql`${table.versionNumber} > 0`),
    check(
      'rule_report_requirement_id_format',
      sql`${table.requirementId} ~ '^[a-z0-9][a-z0-9-]{0,63}$'`,
    ),
    pgPolicy('rule_report_select_reporter', {
      for: 'select',
      to: 'app_api',
      using: isIdentity(table.reporterAccountId),
    }),
    pgPolicy('rule_report_insert_reporter', {
      for: 'insert',
      to: 'app_api',
      withCheck: sql`${isIdentity(table.reporterAccountId)} AND ${isMember(table.caseId)}`,
    }),
    ...erasedByJobs('rule_report', table.reporterAccountId),
    // Approvers read the open reports and close them only through the definer functions.
    ...byDefiner('rule_report', ['select', 'update']),
  ],
);
