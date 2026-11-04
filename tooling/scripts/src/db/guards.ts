import type { ClientBase } from 'pg';
import { appRoles, runtimeRoles, type DatabasePolicy } from './policy.ts';

export interface GuardViolation {
  readonly guard: number;
  readonly problem: string;
}

type Query = Pick<ClientBase, 'query'>;

// Every query names catalog objects by schema, so a migration cannot shadow them, temporary
// objects and session search_path changes included (spec 0001, R7).
const userSchemas = `
  n.nspname <> 'information_schema'
  AND n.nspname !~ '^pg_'`;

async function rows(client: Query, text: string, values: unknown[] = []): Promise<string[]> {
  const result = await client.query<{ problem: string }>(text, values);
  return result.rows.map((row) => row.problem);
}

/** Guard 1: every table in a user schema has row-level security enabled and forced. */
function tablesWithoutForcedRls(client: Query, policy: DatabasePolicy) {
  return rows(
    client,
    `SELECT pg_catalog.format('table %I.%I does not have row-level security enabled and forced', n.nspname, c.relname) AS problem
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND ${userSchemas}
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
        AND NOT (n.nspname || '.' || c.relname = ANY ($1::text[]))
      ORDER BY 1`,
    [policy.guards.tablesWithoutRowLevelSecurity],
  );
}

/** Guard 2: views run as the invoker; materialized views, foreign tables and definer functions need listing. */
function unsafeViewsAndFunctions(client: Query, policy: DatabasePolicy) {
  return rows(
    client,
    `SELECT problem FROM (
       SELECT pg_catalog.format('view %I.%I does not set security_invoker = true', n.nspname, c.relname) AS problem
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'v' AND ${userSchemas}
          AND NOT EXISTS (
            SELECT FROM pg_catalog.pg_options_to_table(c.reloptions) o
             WHERE o.option_name = 'security_invoker'
               AND pg_catalog.lower(o.option_value) IN ('true', 'on', 'yes', '1'))
       UNION ALL
       SELECT pg_catalog.format('%s %I.%I is not allow-listed',
                CASE c.relkind WHEN 'm' THEN 'materialized view' ELSE 'foreign table' END, n.nspname, c.relname)
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE ${userSchemas}
          AND ((c.relkind = 'm' AND NOT (n.nspname || '.' || c.relname = ANY ($1::text[])))
            OR (c.relkind = 'f' AND NOT (n.nspname || '.' || c.relname = ANY ($2::text[]))))
       UNION ALL
       SELECT pg_catalog.format('function %I.%I is SECURITY DEFINER and not allow-listed', n.nspname, p.proname)
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND ${userSchemas}
          AND NOT (n.nspname || '.' || p.proname = ANY ($3::text[]))
     ) found ORDER BY 1`,
    [
      policy.guards.materializedViews,
      policy.guards.foreignTables,
      policy.guards.securityDefinerFunctions,
    ],
  );
}

/** Guard 3: the login roles outside the exempt list are exactly the app roles. */
function unexpectedLoginRoles(client: Query, policy: DatabasePolicy) {
  return rows(
    client,
    `SELECT problem FROM (
       SELECT pg_catalog.format('role %I can log in but is not an app role', r.rolname) AS problem
         FROM pg_catalog.pg_roles r
        WHERE r.rolcanlogin AND NOT (r.rolname = ANY ($1::text[])) AND NOT (r.rolname = ANY ($2::text[]))
       UNION ALL
       SELECT pg_catalog.format('app role %I is missing or cannot log in', expected)
         FROM pg_catalog.unnest($2::text[]) AS expected
        WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles r WHERE r.rolname = expected AND r.rolcanlogin)
     ) found ORDER BY 1`,
    [policy.roles.exemptRoles, appRoles],
  );
}

/** Guard 4: no checked role has a privileged attribute. */
function privilegedRoles(client: Query, policy: DatabasePolicy) {
  return rows(
    client,
    `SELECT pg_catalog.format('role %I has %s', r.rolname, attribute) AS problem
       FROM pg_catalog.pg_roles r
      CROSS JOIN LATERAL (VALUES
        ('SUPERUSER', r.rolsuper), ('BYPASSRLS', r.rolbypassrls), ('REPLICATION', r.rolreplication),
        ('CREATEDB', r.rolcreatedb), ('CREATEROLE', r.rolcreaterole)) AS a(attribute, granted)
      WHERE a.granted AND NOT (r.rolname = ANY ($1::text[]))
      ORDER BY 1`,
    [policy.roles.exemptRoles],
  );
}

/**
 * Guard 5: memberships that touch a checked role are at most the ADMIN OPTION grants Postgres 16+
 * records for the owner role that created each app role, with INHERIT and SET false. Predefined
 * `pg_*` roles (a reserved prefix) are not checked themselves, so their own memberships and the
 * platform's grants of them to exempt roles pass, while granting one to a checked role does not.
 */
function unexpectedMemberships(client: Query, policy: DatabasePolicy) {
  return rows(
    client,
    `SELECT pg_catalog.format('%I is a member of %I (admin %s, inherit %s, set %s)',
              member.rolname, granted.rolname, m.admin_option, m.inherit_option, m.set_option) AS problem
       FROM pg_catalog.pg_auth_members m
       JOIN pg_catalog.pg_roles granted ON granted.oid = m.roleid
       JOIN pg_catalog.pg_roles member ON member.oid = m.member
      WHERE ((NOT (granted.rolname = ANY ($1::text[])) AND granted.rolname !~ '^pg_')
             OR (NOT (member.rolname = ANY ($1::text[])) AND member.rolname !~ '^pg_'))
        AND NOT (member.rolname IS NOT DISTINCT FROM $2::text
                 AND granted.rolname = ANY ($3::text[])
                 AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
      ORDER BY 1`,
    [policy.roles.exemptRoles, policy.roles.ownerAdminRole, appRoles],
  );
}

/** Guard 6: runtime roles own nothing and cannot create anything. */
function runtimeRolePrivileges(client: Query) {
  return rows(
    client,
    `SELECT problem FROM (
       SELECT pg_catalog.format('%I owns %I.%I', r.rolname, n.nspname, c.relname) AS problem
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
        WHERE r.rolname = ANY ($1::text[])
       UNION ALL
       SELECT pg_catalog.format('%I owns schema %I', r.rolname, n.nspname)
         FROM pg_catalog.pg_namespace n
         JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
        WHERE r.rolname = ANY ($1::text[])
       UNION ALL
       SELECT pg_catalog.format('%I has CREATE on schema %I', role_name, n.nspname)
         FROM pg_catalog.pg_namespace n
        CROSS JOIN pg_catalog.unnest($1::text[]) AS role_name
        WHERE EXISTS (SELECT FROM pg_catalog.pg_roles r WHERE r.rolname = role_name)
          AND n.nspname !~ '^pg_(toast_)?temp_'
          AND pg_catalog.has_schema_privilege(role_name, n.oid, 'CREATE')
       UNION ALL
       SELECT pg_catalog.format('%I has CREATE on the database', role_name)
         FROM pg_catalog.unnest($1::text[]) AS role_name
        WHERE EXISTS (SELECT FROM pg_catalog.pg_roles r WHERE r.rolname = role_name)
          AND pg_catalog.has_database_privilege(role_name, pg_catalog.current_database(), 'CREATE')
     ) found ORDER BY 1`,
    [runtimeRoles],
  );
}

/** Guard 7: no role or database defaults outside the allow-list. */
function roleSettings(client: Query, policy: DatabasePolicy) {
  return rows(
    client,
    `SELECT pg_catalog.format('role default %s is not allow-listed', setting) AS problem
       FROM (
         SELECT coalesce(d.datname, '*') || '/' || coalesce(r.rolname, '*') || '/' || config AS setting
           FROM pg_catalog.pg_db_role_setting s
           LEFT JOIN pg_catalog.pg_database d ON d.oid = s.setdatabase
           LEFT JOIN pg_catalog.pg_roles r ON r.oid = s.setrole
          CROSS JOIN LATERAL pg_catalog.unnest(s.setconfig) AS config
       ) found
      WHERE NOT (setting = ANY ($1::text[]))
      ORDER BY 1`,
    [policy.roles.roleSettings],
  );
}

/** Guard 8: the installed extensions are exactly the allow-list. */
function extensions(client: Query, policy: DatabasePolicy) {
  return rows(
    client,
    `SELECT problem FROM (
       SELECT pg_catalog.format('extension %I is not allow-listed', e.extname) AS problem
         FROM pg_catalog.pg_extension e
        WHERE NOT (e.extname = ANY ($1::text[]))
       UNION ALL
       SELECT pg_catalog.format('extension %I is expected but not installed', expected)
         FROM pg_catalog.unnest($1::text[]) AS expected
        WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_extension e WHERE e.extname = expected)
     ) found ORDER BY 1`,
    [policy.roles.extensions],
  );
}

/**
 * Guard 9: nothing deferrable outside the allow-list. A deferred trigger or constraint check runs at
 * COMMIT, after every other guard, so it could undo what they checked. This reads the catalogs; the
 * runner also proves the queue of pending events is empty before it commits.
 */
function deferrableConstraints(client: Query, policy: DatabasePolicy) {
  return rows(
    client,
    `SELECT problem FROM (
       SELECT pg_catalog.format('constraint %I on %I.%I is deferrable and not allow-listed',
                k.conname, n.nspname, c.relname) AS problem
         FROM pg_catalog.pg_constraint k
         JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE k.condeferrable AND ${userSchemas}
          AND NOT (n.nspname || '.' || c.relname || '.' || k.conname = ANY ($1::text[]))
       UNION ALL
       SELECT pg_catalog.format('trigger %I on %I.%I is deferrable', t.tgname, n.nspname, c.relname)
         FROM pg_catalog.pg_trigger t
         JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE t.tgdeferrable AND t.tgconstraint = 0 AND ${userSchemas}
     ) found ORDER BY 1`,
    [policy.guards.deferrableConstraints],
  );
}

/**
 * Guard 10 (spec 0004, R12): app_backup reads every table in a user schema but the not-backed-up
 * list, and only reads. A row-level-security table needs exactly one shape of backup policy, and no
 * policy may reach app_backup or PUBLIC (a policy without `TO`) with any other shape, so every
 * other policy names its roles.
 */
function backupCoverage(client: Query, policy: DatabasePolicy) {
  return rows(
    client,
    `WITH backup AS (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'app_backup'),
     tables AS (
       SELECT c.oid, n.nspname || '.' || c.relname AS name, c.relrowsecurity AS rls,
              n.nspname || '.' || c.relname = ANY ($1::text[]) AS left_out,
              -- Missing, the role is guard 3's problem; the privilege functions would fail on it.
              CASE WHEN EXISTS (SELECT FROM backup)
                THEN pg_catalog.has_table_privilege('app_backup', c.oid, 'SELECT') END AS reads_all,
              CASE WHEN EXISTS (SELECT FROM backup)
                THEN pg_catalog.has_any_column_privilege('app_backup', c.oid, 'SELECT') END AS reads_any,
              CASE WHEN EXISTS (SELECT FROM backup)
                THEN pg_catalog.has_table_privilege('app_backup', c.oid,
                       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                  OR pg_catalog.has_any_column_privilege('app_backup', c.oid, 'INSERT, UPDATE, REFERENCES')
              END AS writes
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p') AND ${userSchemas}),
     policies AS (
       SELECT p.polrelid, p.polname,
              p.polpermissive AND p.polcmd = 'r' AND p.polroles = ARRAY[(SELECT oid FROM backup)]
                AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'true' AND p.polwithcheck IS NULL
                AS backup_shape,
              0::oid = ANY (p.polroles) AS for_public,
              coalesce((SELECT oid FROM backup) = ANY (p.polroles), false) AS for_backup
         FROM pg_catalog.pg_policy p)
     SELECT problem FROM (
       SELECT pg_catalog.format('table %s is neither readable by app_backup nor on the not-backed-up list', t.name) AS problem
         FROM tables t WHERE NOT t.left_out AND t.reads_all IS FALSE
       UNION ALL
       SELECT pg_catalog.format('table %s is on the not-backed-up list but app_backup can read it', t.name)
         FROM tables t WHERE t.left_out AND t.reads_any
       UNION ALL
       SELECT pg_catalog.format('app_backup may write to or reference table %s', t.name)
         FROM tables t WHERE t.writes
       UNION ALL
       SELECT pg_catalog.format('the not-backed-up list names %s, which does not exist', listed)
         FROM pg_catalog.unnest($1::text[]) AS listed
        WHERE NOT EXISTS (SELECT FROM tables t WHERE t.name = listed)
       UNION ALL
       SELECT pg_catalog.format('table %s has row-level security but no backup policy', t.name)
         FROM tables t
        WHERE t.rls AND NOT t.left_out
          AND NOT EXISTS (SELECT FROM policies p WHERE p.polrelid = t.oid AND p.backup_shape)
       UNION ALL
       SELECT pg_catalog.format('policy %I on %s is for app_backup on a table that is not backed up', p.polname, t.name)
         FROM policies p JOIN tables t ON t.oid = p.polrelid
        WHERE t.left_out AND p.for_backup
       UNION ALL
       SELECT pg_catalog.format('policy %I on %s reaches PUBLIC or app_backup with another shape', p.polname, t.name)
         FROM policies p JOIN tables t ON t.oid = p.polrelid
        WHERE p.for_public OR (p.for_backup AND NOT p.backup_shape)
     ) found ORDER BY 1`,
    [policy.guards.notBackedUp],
  );
}

const guards = [
  tablesWithoutForcedRls,
  unsafeViewsAndFunctions,
  unexpectedLoginRoles,
  privilegedRoles,
  unexpectedMemberships,
  (client: Query) => runtimeRolePrivileges(client),
  roleSettings,
  extensions,
  deferrableConstraints,
  backupCoverage,
] as const;

/** Runs guards 1 to 10 (spec 0001 R7, spec 0004 R12) and returns every violation, numbered by guard. */
export async function runGuards(client: Query, policy: DatabasePolicy): Promise<GuardViolation[]> {
  const violations: GuardViolation[] = [];
  for (const [index, guard] of guards.entries()) {
    for (const problem of await guard(client, policy))
      violations.push({ guard: index + 1, problem });
  }
  return violations;
}
