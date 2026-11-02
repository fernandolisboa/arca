import pg from 'pg';

/** The roles the running services connect as (spec 0001, R7). */
export type RuntimeRole = 'app_api' | 'app_jobs';

const runtimeRoles: ReadonlySet<string> = new Set<RuntimeRole>(['app_api', 'app_jobs']);

export interface DatabaseTarget {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  /** TLS with certificate verification; off only for a loopback test server. */
  readonly ssl: boolean;
}

export interface RoleCredentials {
  readonly role: RuntimeRole;
  readonly password: string;
}

export interface PoolLimits {
  readonly max?: number;
  readonly connectionTimeoutMillis?: number;
  readonly idleTimeoutMillis?: number;
}

/** A connection logged in as, or switched to, a role other than the one the pool was made for. */
export class WrongRoleError extends Error {
  override name = 'WrongRoleError';
  readonly expected: RuntimeRole;

  constructor(expected: RuntimeRole) {
    super(`the connection is not running as ${expected}`);
    this.expected = expected;
  }
}

export class DatabaseConfigError extends Error {
  override name = 'DatabaseConfigError';
}

function requireText(field: string, value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new DatabaseConfigError(`database ${field} is missing`);
  }
  return value;
}

/**
 * Checked at run time as well as by type, so a caller that loses a field fails here instead of
 * letting node-postgres fill it from PG* variables, which belong to the owner role.
 */
function validated(target: DatabaseTarget, credentials: RoleCredentials) {
  const role = requireText('role', credentials.role);
  if (!runtimeRoles.has(role)) throw new DatabaseConfigError('database role is not a runtime role');
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65_535) {
    throw new DatabaseConfigError('database port is invalid');
  }
  if (typeof target.ssl !== 'boolean') throw new DatabaseConfigError('database ssl is missing');
  return {
    host: requireText('host', target.host),
    port: target.port,
    database: requireText('database', target.database),
    role: role as RuntimeRole,
    password: requireText('password', credentials.password),
    ssl: target.ssl,
  };
}

async function verifyRole(client: pg.ClientBase, role: RuntimeRole): Promise<void> {
  const result = await client.query<{ current: string; session: string }>(
    'SELECT current_user AS current, session_user AS session',
  );
  const row = result.rows[0];
  if (row?.current !== role || row.session !== role) throw new WrongRoleError(role);
}

type PoolOptions = pg.PoolConfig & { onConnect: (client: pg.ClientBase) => Promise<void> };

/**
 * A pool that logs in as one runtime role with every connection field given explicitly. Each new
 * connection must prove `current_user` and `session_user` are that role before it is handed out;
 * otherwise it is closed and the caller gets a WrongRoleError, so no query runs under another role.
 */
export function createRolePool(
  target: DatabaseTarget,
  credentials: RoleCredentials,
  limits: PoolLimits = {},
): pg.Pool {
  const { host, port, database, role, password, ssl } = validated(target, credentials);
  const options: PoolOptions = {
    host,
    port,
    database,
    user: role,
    password,
    ssl: ssl ? { rejectUnauthorized: true } : false,
    application_name: `arca-${role}`,
    client_encoding: 'UTF8',
    max: limits.max ?? 5,
    connectionTimeoutMillis: limits.connectionTimeoutMillis ?? 5_000,
    idleTimeoutMillis: limits.idleTimeoutMillis ?? 10_000,
    onConnect: (client) => verifyRole(client, role),
  };
  return new pg.Pool(options);
}

/** `ok` when queries run as `role`, `wrong_role` when they would not; throws if unreachable. */
export async function roleStatus(
  pool: Pick<pg.Pool, 'query'>,
  role: RuntimeRole,
): Promise<'ok' | 'wrong_role'> {
  try {
    const result = await pool.query<{ current: string }>('SELECT current_user AS current');
    return result.rows[0]?.current === role ? 'ok' : 'wrong_role';
  } catch (error) {
    if (error instanceof WrongRoleError) return 'wrong_role';
    throw error;
  }
}

/** Fails unless queries on `pool` run as `role`; a service calls it before it serves. */
export async function assertRole(pool: Pick<pg.Pool, 'query'>, role: RuntimeRole): Promise<void> {
  if ((await roleStatus(pool, role)) !== 'ok') throw new WrongRoleError(role);
}
