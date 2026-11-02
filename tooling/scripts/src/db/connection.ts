import pg from 'pg';

/**
 * Every field that could change who connects or how the server reads SQL is given explicitly,
 * because node-postgres fills missing ones from PG* variables (PGOPTIONS and PGCLIENTENCODING
 * included).
 */
export interface ConnectionTarget {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly ssl: boolean;
}

export function clientFor(target: ConnectionTarget, applicationName = 'arca-migrate'): pg.Client {
  return new pg.Client({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: target.password,
    ssl: target.ssl ? { rejectUnauthorized: true } : false,
    enableChannelBinding: target.ssl,
    application_name: applicationName,
    client_encoding: 'UTF8',
    // Never empty: node-postgres would fall back to PGOPTIONS, which could set
    // standard_conforming_strings off before the runner's parser and the server disagree on a split.
    options: '-c standard_conforming_strings=on',
  });
}

export type Environment = Readonly<Record<string, string | undefined>>;

export function requiredVariable(env: Environment, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

const loopback = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * The unpooled target for a build step (spec 0001, R7): host and database come from the variables
 * the Neon integration injects; user and password are passed in by the step. TLS is required
 * except on a loopback host, where the CI container listens.
 */
export function buildTarget(
  env: Environment,
  credentials: { readonly user: string; readonly password: string },
): ConnectionTarget {
  const host = requiredVariable(env, 'PGHOST_UNPOOLED');
  const port = Number(env['PGPORT'] ?? '5432');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PGPORT is not a port');
  return {
    host,
    port,
    database: requiredVariable(env, 'PGDATABASE'),
    user: credentials.user,
    password: credentials.password,
    ssl: !loopback.has(host),
  };
}
