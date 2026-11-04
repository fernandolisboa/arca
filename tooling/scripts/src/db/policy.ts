import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord } from '../report.ts';

export type EnvironmentName = 'container' | 'neon';

/** Lists the guards read per environment (packages/db/policy/environments.json). */
export interface EnvironmentPolicy {
  /** Roles the guards do not check: the platform's managed roles. */
  readonly exemptRoles: readonly string[];
  /** The role that may hold ADMIN OPTION on each app role, as Postgres records for its creator. */
  readonly ownerAdminRole: string | null;
  /** Exactly the extensions the database may have. */
  readonly extensions: readonly string[];
  /** `pg_db_role_setting` rows allowed, as `<database or *>/<role or *>/<setting>`. */
  readonly roleSettings: readonly string[];
}

/** Allow-lists shared by every environment (packages/db/policy/guards.json). */
export interface GuardPolicy {
  /** Qualified names (`schema.table`) of tables allowed without forced row-level security. */
  readonly tablesWithoutRowLevelSecurity: readonly string[];
  readonly materializedViews: readonly string[];
  readonly foreignTables: readonly string[];
  /** Qualified names (`schema.function`) of SECURITY DEFINER functions. */
  readonly securityDefinerFunctions: readonly string[];
  /** Extensions a migration may create. */
  readonly migrationExtensions: readonly string[];
  /**
   * Qualified names (`schema.table.constraint`) of deferrable constraints. Deferred checks run at
   * COMMIT, after the guards, so each entry needs a review of what code its check can reach.
   */
  readonly deferrableConstraints: readonly string[];
}

export interface DatabasePolicy {
  readonly environment: EnvironmentName;
  readonly roles: EnvironmentPolicy;
  readonly guards: GuardPolicy;
}

export const appRoles = ['app_migrator', 'app_api', 'app_jobs', 'app_auth', 'app_audit'] as const;
/** Roles bootstrap keeps without login so old migrations replay (ADR-0021 retired app_backup). */
export const retiredRoles = ['app_backup'] as const;
export const migratorRole = 'app_migrator';
export const runtimeRoles = appRoles.filter((role) => role !== migratorRole);

/**
 * The environment follows from the host the runner connects to, never from migration data or an
 * environment variable a build could set.
 */
export function environmentFor(host: string): EnvironmentName {
  return /\.neon\.tech\.?$/i.test(host) ? 'neon' : 'container';
}

function stringList(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item !== '')) {
    throw new Error(`${where} must be a list of non-empty strings`);
  }
  return value as string[];
}

export function parseEnvironmentPolicy(value: unknown, where: string): EnvironmentPolicy {
  if (!isRecord(value)) throw new Error(`${where} must be an object`);
  const owner = value['ownerAdminRole'];
  if (owner !== null && (typeof owner !== 'string' || owner === '')) {
    throw new Error(`${where}.ownerAdminRole must be a role name or null`);
  }
  return {
    exemptRoles: stringList(value['exemptRoles'], `${where}.exemptRoles`),
    ownerAdminRole: owner,
    extensions: stringList(value['extensions'], `${where}.extensions`),
    roleSettings: stringList(value['roleSettings'], `${where}.roleSettings`),
  };
}

/** A list of `{ table, reason }` entries, so every table left without row-level security says why. */
function tablesWithReasons(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${where} must be a list`);
  return value.map((entry, index) => {
    const { table, reason } = isRecord(entry) ? entry : {};
    if (typeof table !== 'string' || table === '' || typeof reason !== 'string' || reason === '') {
      throw new Error(`${where}[${String(index)}] must have a table and a reason`);
    }
    return table;
  });
}

export function parseGuardPolicy(value: unknown): GuardPolicy {
  if (!isRecord(value)) throw new Error('guards.json must be an object');
  const list = (key: keyof GuardPolicy) => stringList(value[key], `guards.json ${key}`);
  return {
    tablesWithoutRowLevelSecurity: tablesWithReasons(
      value['tablesWithoutRowLevelSecurity'],
      'guards.json tablesWithoutRowLevelSecurity',
    ),
    materializedViews: list('materializedViews'),
    foreignTables: list('foreignTables'),
    securityDefinerFunctions: list('securityDefinerFunctions'),
    migrationExtensions: list('migrationExtensions'),
    deferrableConstraints: list('deferrableConstraints'),
  };
}

export async function readDatabasePolicy(
  policyDir: string,
  environment: EnvironmentName,
): Promise<DatabasePolicy> {
  const read = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(join(policyDir, file), 'utf8'));
  const environments = await read('environments.json');
  if (!isRecord(environments)) throw new Error('environments.json must be an object');
  return {
    environment,
    roles: parseEnvironmentPolicy(environments[environment], `environments.json ${environment}`),
    guards: parseGuardPolicy(await read('guards.json')),
  };
}
