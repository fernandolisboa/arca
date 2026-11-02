import pg from 'pg';

/** The roles the running services connect as (spec 0001, R7). */
export type RuntimeRole = 'app_api' | 'app_jobs';

const runtimeRoles: ReadonlySet<string> = new Set<RuntimeRole>(['app_api', 'app_jobs']);

const loopbackHosts: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1']);

export interface DatabaseTarget {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  /** TLS with certificate verification; may be off only for a loopback test server. */
  readonly ssl: boolean;
}

export interface RoleCredentials {
  readonly role: RuntimeRole;
  readonly password: string;
}

export interface PoolOptions {
  readonly max?: number;
  readonly connectionTimeoutMillis?: number;
  readonly idleTimeoutMillis?: number;
  /** Client-side limit per query, the role check included, so a stalled query frees its slot. */
  readonly queryTimeoutMillis?: number;
  /**
   * Called when an idle connection fails (a restarted compute or pooler, a dropped network). The
   * pool has already discarded it; without a listener Node would end the process.
   */
  readonly onIdleError?: (error: Error) => void;
}

/**
 * A new connection that is not safe to hand out: it runs as another role than the pool was made
 * for, or it starts with a request identity already set (a session default from PGOPTIONS or a
 * role setting), which would leak into queries run outside withIdentity.
 */
export class ConnectionCheckError extends Error {
  override name = 'ConnectionCheckError';
  readonly reason: 'role' | 'identity';

  constructor(reason: 'role' | 'identity', role: RuntimeRole) {
    super(
      reason === 'role'
        ? `the connection is not running as ${role}`
        : 'the connection starts with a request identity already set',
    );
    this.reason = reason;
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
  const host = requireText('host', target.host);
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65_535) {
    throw new DatabaseConfigError('database port is invalid');
  }
  if (typeof target.ssl !== 'boolean') throw new DatabaseConfigError('database ssl is missing');
  if (!target.ssl && !loopbackHosts.has(host)) {
    throw new DatabaseConfigError('database TLS may be off only for a loopback host');
  }
  return {
    host,
    port: target.port,
    database: requireText('database', target.database),
    role: role as RuntimeRole,
    password: requireText('password', credentials.password),
    ssl: target.ssl,
  };
}

async function verifyConnection(client: pg.ClientBase, role: RuntimeRole): Promise<void> {
  const result = await client.query<{ current: string; session: string; identity: string }>(
    `SELECT current_user AS current, session_user AS session,
            coalesce(current_setting('app.person_id', true), '') ||
            coalesce(current_setting('app.case_id', true), '') AS identity`,
  );
  const row = result.rows[0];
  if (row?.current !== role || row.session !== role) throw new ConnectionCheckError('role', role);
  if (row.identity !== '') throw new ConnectionCheckError('identity', role);
}

type PgPoolOptions = pg.PoolConfig & { onConnect: (client: pg.ClientBase) => Promise<void> };

/**
 * A pool that logs in as one runtime role with every connection field given explicitly. Each new
 * connection must prove `current_user` and `session_user` are that role, and that no request
 * identity is preset, before it is handed out; otherwise it is closed and the caller gets a
 * ConnectionCheckError, so no query runs under another role or identity.
 */
export function createRolePool(
  target: DatabaseTarget,
  credentials: RoleCredentials,
  options: PoolOptions = {},
): pg.Pool {
  const { host, port, database, role, password, ssl } = validated(target, credentials);
  const config: PgPoolOptions = {
    host,
    port,
    database,
    user: role,
    password,
    ssl: ssl ? { rejectUnauthorized: true } : false,
    application_name: `arca-${role}`,
    client_encoding: 'UTF8',
    max: options.max ?? 5,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 10_000,
    query_timeout: options.queryTimeoutMillis ?? 15_000,
    onConnect: (client) => verifyConnection(client, role),
  };
  const pool = new pg.Pool(config);
  const onIdleError = options.onIdleError;
  pool.on('error', (error) => {
    onIdleError?.(error);
  });
  return pool;
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
    if (error instanceof ConnectionCheckError) return 'wrong_role';
    throw error;
  }
}

/** Fails unless queries on `pool` run as `role`; a service calls it before it serves. */
export async function assertRole(pool: Pick<pg.Pool, 'query'>, role: RuntimeRole): Promise<void> {
  if ((await roleStatus(pool, role)) !== 'ok') throw new ConnectionCheckError('role', role);
}
