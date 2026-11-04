import type { DatabaseTarget } from '@arca/db';
import { enrollmentCodeHash } from './auth/enrollment-code-hash.js';
import { productionSite, type ProductionSite } from './production-site.js';

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

export const hostNamePattern = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;

export type DeploymentEnvironment = 'production' | 'preview' | 'development';

/**
 * Which deployment this is, from Vercel's system variables. Off Vercel it is development; on
 * Vercel a missing or unknown VERCEL_ENV fails instead of falling back to it, and so does a custom
 * environment, which Vercel reports as a preview.
 */
export function readDeploymentEnvironment(): DeploymentEnvironment {
  if (process.env['VERCEL'] !== '1') return 'development';
  const environment = required('VERCEL_ENV', process.env['VERCEL_ENV']);
  if (environment !== 'production' && environment !== 'preview' && environment !== 'development') {
    throw new MissingConfigError('VERCEL_ENV is not a known environment');
  }
  const target = process.env['VERCEL_TARGET_ENV'];
  if (target !== undefined && target !== environment) {
    throw new MissingConfigError('custom Vercel environments are not supported');
  }
  return environment;
}

const localOriginPattern = /^http:\/\/localhost:[0-9]{2,5}$/;

/**
 * Off Vercel, Nitro's dev server, or `ARCA_LOCAL_ORIGIN` for another local port (the end-to-end
 * server). Only a localhost origin is accepted, since WebAuthn needs a host name, not an address.
 */
function readLocalOrigin(): string {
  const origin = process.env['ARCA_LOCAL_ORIGIN'];
  if (origin === undefined || origin === '') return 'http://localhost:3000';
  if (!localOriginPattern.test(origin)) {
    throw new MissingConfigError('ARCA_LOCAL_ORIGIN is not a localhost origin');
  }
  return origin;
}

/**
 * The origin the auth routes run on: in production the host the reviewed site file names (spec
 * 0003, R9), or Vercel's production URL while it names none, when production takes no accounts;
 * a preview's branch URL, so the per-deployment URL is never trusted; in development, Nitro's dev
 * server.
 */
export function readAuthOrigin(site: ProductionSite = productionSite): string {
  const environment = readDeploymentEnvironment();
  if (environment === 'development') return readLocalOrigin();
  const [name, value] =
    environment === 'production'
      ? site.host === null
        ? ['VERCEL_PROJECT_PRODUCTION_URL', process.env['VERCEL_PROJECT_PRODUCTION_URL']]
        : ['the production site host', site.host]
      : ['VERCEL_BRANCH_URL', process.env['VERCEL_BRANCH_URL']];
  const host = required(name, value).toLowerCase();
  if (!hostNamePattern.test(host)) throw new MissingConfigError(`${name} is not a host name`);
  return `https://${host}`;
}

/** The auth origin, or undefined while its setting is missing, for callers that can do without. */
export function readOwnOrigin(): string | undefined {
  try {
    return readAuthOrigin();
  } catch {
    return undefined;
  }
}

const resendKeyPattern = /^re_[A-Za-z0-9_-]+$/;

/**
 * Resend's API key, a Sensitive Production variable (spec 0003, R8). A missing or malformed one
 * counts as absent, so production stays closed instead of opening with every send failing.
 */
export function readResendKey(): string | undefined {
  const key = process.env['RESEND_API_KEY']?.trim();
  return key !== undefined && resendKeyPattern.test(key) ? key : undefined;
}

/**
 * The environment's VAPID private key, a Sensitive variable (spec 0005, R7): the P-256 private
 * scalar alone, 43 characters of base64url, never a JWK or PEM.
 */
export function readVapidPrivateKey(): string | undefined {
  const key = process.env['ARCA_VAPID_PRIVATE_KEY']?.trim();
  return key === '' ? undefined : key;
}

/**
 * Keys the HMACs of the rate-limit counters (spec 0003, R10). Only the environment holds it, so
 * the database never holds anything that recovers an address; rotating it resets the counters.
 */
export function readRateLimitKey(): string {
  const key = required('ARCA_RATE_LIMIT_KEY', process.env['ARCA_RATE_LIMIT_KEY']);
  if (key.length < 32) {
    throw new MissingConfigError('ARCA_RATE_LIMIT_KEY is shorter than 32 characters');
  }
  return key;
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

const sha256HexPattern = /^[0-9a-f]{64}$/;

/**
 * The owner enrollment code's hash (spec 0003, R2): the committed one, or in development only
 * `ARCA_ENROLLMENT_CODE_HASH`, so a local or end-to-end server can enroll with a code of its own.
 * Null keeps owner enrollment closed.
 */
export function readEnrollmentCodeHash(environment: DeploymentEnvironment): string | null {
  const local =
    environment === 'development' ? process.env['ARCA_ENROLLMENT_CODE_HASH'] : undefined;
  const hash = local === undefined || local === '' ? enrollmentCodeHash : local;
  if (hash !== null && !sha256HexPattern.test(hash)) {
    throw new MissingConfigError('the enrollment code hash is not a SHA-256 hex digest');
  }
  return hash;
}
