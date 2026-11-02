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
