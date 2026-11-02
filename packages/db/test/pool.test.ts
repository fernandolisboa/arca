import { describe, expect, it } from 'vitest';
import {
  ConnectionCheckError,
  createRolePool,
  DatabaseConfigError,
  roleStatus,
  type DatabaseTarget,
  type RoleCredentials,
} from '../src/pool.js';

const target: DatabaseTarget = { host: 'db.example.test', port: 5432, database: 'arca', ssl: true };
const credentials: RoleCredentials = { role: 'app_api', password: 'secret-for-tests-only' };

describe('createRolePool', () => {
  it.each([
    ['no host', { ...target, host: '' }, credentials],
    ['no database', { ...target, database: undefined as unknown as string }, credentials],
    ['a port out of range', { ...target, port: 70_000 }, credentials],
    ['no ssl choice', { ...target, ssl: undefined as unknown as boolean }, credentials],
    ['no role', target, { password: credentials.password } as RoleCredentials],
    ['an owner role', target, { ...credentials, role: 'neondb_owner' as 'app_api' }],
    ['no password', target, { role: 'app_api' } as RoleCredentials],
    ['TLS off for a remote host', { ...target, ssl: false }, credentials],
  ])('refuses %s instead of falling back to PG* variables', (_label, badTarget, badCredentials) => {
    expect(() => createRolePool(badTarget, badCredentials)).toThrow(DatabaseConfigError);
  });
});

describe('createRolePool on a loopback host', () => {
  it('allows TLS off', async () => {
    const pool = createRolePool({ ...target, host: '127.0.0.1', ssl: false }, credentials);
    await pool.end();
  });
});

describe('roleStatus', () => {
  const answering = (rows: { current: string }[]) => ({
    query: () => Promise.resolve({ rows }),
  });

  it('is ok when the query runs as the role', async () => {
    expect(await roleStatus(answering([{ current: 'app_api' }]) as never, 'app_api')).toBe('ok');
  });

  it('is wrong_role when the query runs as another role', async () => {
    expect(await roleStatus(answering([{ current: 'app_jobs' }]) as never, 'app_api')).toBe(
      'wrong_role',
    );
  });

  it('is wrong_role when the pool refused a connection with a preset identity', async () => {
    const pool = { query: () => Promise.reject(new ConnectionCheckError('identity', 'app_api')) };
    expect(await roleStatus(pool as never, 'app_api')).toBe('wrong_role');
  });

  it('is wrong_role when the pool refused the connection for its role', async () => {
    const pool = { query: () => Promise.reject(new ConnectionCheckError('role', 'app_api')) };
    expect(await roleStatus(pool as never, 'app_api')).toBe('wrong_role');
  });

  it('rethrows other failures', async () => {
    const pool = { query: () => Promise.reject(new Error('connection refused')) };
    await expect(roleStatus(pool as never, 'app_api')).rejects.toThrow('connection refused');
  });
});
