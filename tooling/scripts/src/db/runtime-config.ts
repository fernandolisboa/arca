import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { requiredVariable, type Environment } from './connection.ts';

export interface RuntimeDatabaseConfig {
  readonly host: string;
  readonly name: string;
}

const hostPattern = /^[A-Za-z0-9.-]{1,253}$/;
const namePattern = /^[A-Za-z0-9_-]{1,63}$/;

/**
 * The pooled host and the database name, the only database settings the API gets at build time
 * (spec 0001, R7). Neither is secret; the owner's user and password are never read here.
 */
export function runtimeDatabaseConfig(env: Environment): RuntimeDatabaseConfig {
  const host = requiredVariable(env, 'PGHOST');
  const name = requiredVariable(env, 'PGDATABASE');
  if (!hostPattern.test(host)) throw new Error('PGHOST is not a host name');
  if (!namePattern.test(name)) throw new Error('PGDATABASE is not a plain database name');
  return { host, name };
}

export async function writeRuntimeDatabaseConfig(env: Environment, file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(runtimeDatabaseConfig(env), null, 2)}\n`);
}
