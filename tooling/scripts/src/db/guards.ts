import type { ClientBase } from 'pg';
import {
  appRoles,
  definerRoleSchemas,
  definerRoles,
  migratorRole,
  retiredRoles,
  runtimeRoles,
  type DatabasePolicy,
} from './policy.ts';

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

/**
 * Guard 2: views run as the invoker; materialized views, foreign tables and definer functions need
 * listing, and a definer function is owned by a definer role and pins its search_path.
 */
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
       UNION ALL
       SELECT pg_catalog.format('function %I.%I is SECURITY DEFINER but owned by %I, not a definer role',
                n.nspname, p.proname, r.rolname)
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
        WHERE p.prosecdef AND ${userSchemas}
          AND NOT (r.rolname = ANY ($4::text[]))
       UNION ALL
       SELECT pg_catalog.format('function %I.%I is SECURITY DEFINER and does not pin search_path', n.nspname, p.proname)
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND ${userSchemas}
          AND NOT EXISTS (
            SELECT FROM pg_catalog.unnest(p.proconfig) AS setting
             WHERE setting = 'search_path=pg_catalog, pg_temp')
     ) found ORDER BY 1`,
    [
      policy.guards.materializedViews,
      policy.guards.foreignTables,
      policy.guards.securityDefinerFunctions,
      definerRoles,
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
 * records for the owner role that created each app role, with INHERIT and SET false, and the
 * migrator's SET-only membership in each definer role. Predefined
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
        AND NOT (member.rolname = $4::text
                 AND granted.rolname = ANY ($5::text[])
                 AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option)
      ORDER BY 1`,
    [
      policy.roles.exemptRoles,
      policy.roles.ownerAdminRole,
      [...appRoles, ...retiredRoles, ...definerRoles],
      migratorRole,
      definerRoles,
    ],
  );
}

/**
 * Guard 6: runtime, retired and definer roles own no relation or schema and cannot create
 * anything; a definer role owns only its allow-listed functions (guard 2).
 */
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
    [[...runtimeRoles, ...retiredRoles, ...definerRoles]],
  );
}

/**
 * Guard 6, continued: a definer role holds no privilege on a schema, table or column outside its
 * own schema, since the code of its functions cannot be guarded.
 */
function definerRoleReach(client: Query) {
  const entries = Object.entries(definerRoleSchemas);
  return rows(
    client,
    `SELECT problem FROM (
       SELECT pg_catalog.format('%I holds privileges on schema %I, outside %I', d.role, n.nspname, d.home) AS problem
         FROM ROWS FROM (pg_catalog.unnest($1::text[]), pg_catalog.unnest($2::text[])) AS d(role, home)
         JOIN pg_catalog.pg_roles r ON r.rolname = d.role
         JOIN pg_catalog.pg_namespace n ON n.nspname <> d.home
        WHERE EXISTS (SELECT FROM pg_catalog.aclexplode(n.nspacl) a WHERE a.grantee = r.oid)
       UNION ALL
       SELECT pg_catalog.format('%I holds privileges on %I.%I, outside %I', d.role, n.nspname, c.relname, d.home)
         FROM ROWS FROM (pg_catalog.unnest($1::text[]), pg_catalog.unnest($2::text[])) AS d(role, home)
         JOIN pg_catalog.pg_roles r ON r.rolname = d.role
         JOIN pg_catalog.pg_namespace n ON n.nspname <> d.home
         JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid
        WHERE EXISTS (SELECT FROM pg_catalog.aclexplode(c.relacl) a WHERE a.grantee = r.oid)
           OR EXISTS (SELECT FROM pg_catalog.pg_attribute t
                       CROSS JOIN LATERAL pg_catalog.aclexplode(t.attacl) a
                       WHERE t.attrelid = c.oid AND a.grantee = r.oid)
     ) found ORDER BY 1`,
    [entries.map(([role]) => role), entries.map(([, home]) => home)],
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

const guards = [
  tablesWithoutForcedRls,
  unsafeViewsAndFunctions,
  unexpectedLoginRoles,
  privilegedRoles,
  unexpectedMemberships,
  async (client: Query) => [
    ...(await runtimeRolePrivileges(client)),
    ...(await definerRoleReach(client)),
  ],
  roleSettings,
  extensions,
  deferrableConstraints,
] as const;

/** Runs guards 1 to 9 (spec 0001 R7) and returns every violation, numbered by guard. */
export async function runGuards(client: Query, policy: DatabasePolicy): Promise<GuardViolation[]> {
  const violations: GuardViolation[] = [];
  for (const [index, guard] of guards.entries()) {
    for (const problem of await guard(client, policy))
      violations.push({ guard: index + 1, problem });
  }
  return violations;
}
