import { afterEach, describe, expect, it, vi } from 'vitest';
import { databaseTargetFrom, MissingConfigError, readApiSecrets } from '../src/config.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readApiSecrets', () => {
  it('reads the app_api password by name', () => {
    vi.stubEnv('ARCA_DB_API_PASSWORD', 'test-only-password');
    expect(readApiSecrets()).toEqual({ databasePassword: 'test-only-password' });
  });

  it.each([undefined, ''])('fails when the password is %j', (value) => {
    vi.stubEnv('ARCA_DB_API_PASSWORD', value);
    expect(() => readApiSecrets()).toThrow(MissingConfigError);
  });

  it('never falls back to the owner password', () => {
    vi.stubEnv('ARCA_DB_API_PASSWORD', undefined);
    vi.stubEnv('PGPASSWORD', 'owner-password');
    expect(() => readApiSecrets()).toThrow('ARCA_DB_API_PASSWORD is not set');
  });
});

describe('databaseTargetFrom', () => {
  it('uses TLS for a remote host and the default port', () => {
    expect(
      databaseTargetFrom({ host: 'ep-x-pooler.sa-east-1.aws.neon.tech', name: 'arca' }),
    ).toEqual({
      host: 'ep-x-pooler.sa-east-1.aws.neon.tech',
      port: 5432,
      database: 'arca',
      ssl: true,
    });
  });

  it('turns TLS off only for loopback', () => {
    expect(databaseTargetFrom({ host: '127.0.0.1', name: 'arca' }).ssl).toBe(false);
  });

  it.each([undefined, {}, { host: 'h' }, { host: 'h/x', name: 'arca' }, { host: 'h', name: "a'" }])(
    'fails on %j',
    (value) => {
      expect(() => databaseTargetFrom(value)).toThrow(MissingConfigError);
    },
  );
});
