import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissingConfigError, readApiSecrets } from '../src/config.js';

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
