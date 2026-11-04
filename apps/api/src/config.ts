import type { DatabaseTarget } from '@arca/db';

/**
 * The one place the API reads its configuration (spec 0001, R7): environment variables, each by
 * name, and the database host and name that a build script wrote into the Nitro runtime config.
 * The owner's PG* variables carry those too, but only build scripts may read them.
 */
export class MissingConfigError extends Error {
  override name = 'MissingConfigError';
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value === '') throw new MissingConfigError(`${name} is not set`);
  return value;
}

export interface ApiSecrets {
  readonly databasePassword: string;
}

export function readApiSecrets(): ApiSecrets {
  return {
    databasePassword: required('ARCA_DB_API_PASSWORD', process.env['ARCA_DB_API_PASSWORD']),
  };
}

/** The app_jobs password, read only by workflow steps. */
export function readJobsDatabasePassword(): string {
  return required('ARCA_DB_JOBS_PASSWORD', process.env['ARCA_DB_JOBS_PASSWORD']);
}

/** The app_audit password, for the audit log's writer (spec 0003, R7). */
export function readAuditDatabasePassword(): string {
  return required('ARCA_DB_AUDIT_PASSWORD', process.env['ARCA_DB_AUDIT_PASSWORD']);
}

export interface AuthSecrets {
  /** The app_auth role's password, for Better Auth's own pool (spec 0003, R1). */
  readonly databasePassword: string;
  /** Signs Better Auth's cookies; distinct per environment. */
  readonly secret: string;
}

export function readAuthSecrets(): AuthSecrets {
  const secret = required('BETTER_AUTH_SECRET', process.env['BETTER_AUTH_SECRET']);
  if (secret.length < 32) {
    throw new MissingConfigError('BETTER_AUTH_SECRET is shorter than 32 characters');
  }
  return {
    databasePassword: required('ARCA_DB_AUTH_PASSWORD', process.env['ARCA_DB_AUTH_PASSWORD']),
    secret,
  };
}

const originHostPattern = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;

/**
 * The origin the auth routes run on, from Vercel's system variables: a preview's branch URL, so
 * the per-deployment URL is not trusted, and the production domain. Until spec 0003 R9 moves
 * production to a reviewed file, the production host is Vercel's. Off Vercel, Nitro's dev server;
 * on Vercel a missing or unknown environment fails instead of falling back to it.
 */
export function readAuthOrigin(): string {
  if (process.env['VERCEL'] !== '1') return 'http://localhost:3000';
  const environment = required('VERCEL_ENV', process.env['VERCEL_ENV']);
  if (environment === 'development') return 'http://localhost:3000';
  if (environment !== 'production' && environment !== 'preview') {
    throw new MissingConfigError('VERCEL_ENV is not a known environment');
  }
  const [name, value] =
    environment === 'production'
      ? ['VERCEL_PROJECT_PRODUCTION_URL', process.env['VERCEL_PROJECT_PRODUCTION_URL']]
      : ['VERCEL_BRANCH_URL', process.env['VERCEL_BRANCH_URL']];
  const host = required(name, value).toLowerCase();
  if (!originHostPattern.test(host)) throw new MissingConfigError(`${name} is not a host name`);
  return `https://${host}`;
}

/** Vercel sends it as a bearer token on cron requests; production only. */
export function readCronSecret(): string {
  const secret = required('CRON_SECRET', process.env['CRON_SECRET']);
  // Guessing is the only attack on it, and the route has no rate limit.
  if (secret.length < 32) throw new MissingConfigError('CRON_SECRET is shorter than 32 characters');
  return secret;
}

const hostPattern = /^[A-Za-z0-9.-]{1,253}$/;
const databaseNamePattern = /^[A-Za-z0-9_-]{1,63}$/;
const loopbackHosts: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

/** Validates the build-time database settings; TLS is on for every host but loopback. */
export function databaseTargetFrom(value: unknown): DatabaseTarget {
  const { host, name } = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  if (typeof host !== 'string' || !hostPattern.test(host)) {
    throw new MissingConfigError('the database host was not configured at build time');
  }
  if (typeof name !== 'string' || !databaseNamePattern.test(name)) {
    throw new MissingConfigError('the database name was not configured at build time');
  }
  return { host, port: 5432, database: name, ssl: !loopbackHosts.has(host) };
}
