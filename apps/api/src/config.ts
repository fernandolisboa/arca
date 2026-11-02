/**
 * The one place the API reads environment variables, each by name (spec 0001, R7). The database
 * host and name are not read here: the owner's PG* variables carry them, and only build scripts
 * may read those.
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
