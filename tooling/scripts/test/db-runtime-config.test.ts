import { describe, expect, it } from 'vitest';
import { runtimeDatabaseConfig } from '../src/db/runtime-config.ts';

const env = {
  PGHOST: 'ep-example-pooler.sa-east-1.aws.neon.tech',
  PGDATABASE: 'arca',
  PGUSER: 'owner-user',
  PGPASSWORD: 'owner-password',
};

describe('runtimeDatabaseConfig', () => {
  it('keeps only the pooled host and the database name', () => {
    expect(runtimeDatabaseConfig(env)).toEqual({
      host: 'ep-example-pooler.sa-east-1.aws.neon.tech',
      name: 'arca',
    });
  });

  it.each([
    ['a missing host', { ...env, PGHOST: undefined }],
    ['a missing database', { ...env, PGDATABASE: '' }],
    ['a host with a path', { ...env, PGHOST: 'h/x' }],
    ['a database with a quote', { ...env, PGDATABASE: "arca'" }],
  ])('fails on %s', (_label, bad) => {
    expect(() => runtimeDatabaseConfig(bad)).toThrow();
  });
});
