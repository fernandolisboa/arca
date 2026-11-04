import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  databaseTargetFrom,
  MissingConfigError,
  readApiSecrets,
  readAuthOrigin,
  readDeploymentEnvironment,
  readAuthSecrets,
  readCronSecret,
  readJobsDatabasePassword,
} from '../src/config.js';

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

describe('readJobsDatabasePassword', () => {
  it('reads the app_jobs password by name', () => {
    vi.stubEnv('ARCA_DB_JOBS_PASSWORD', 'test-only-password');
    expect(readJobsDatabasePassword()).toBe('test-only-password');
  });

  it.each([undefined, ''])('fails when the password is %j', (value) => {
    vi.stubEnv('ARCA_DB_JOBS_PASSWORD', value);
    expect(() => readJobsDatabasePassword()).toThrow(MissingConfigError);
  });
});

describe('readCronSecret', () => {
  it('reads a secret of 32 characters or more', () => {
    vi.stubEnv('CRON_SECRET', 'x'.repeat(32));
    expect(readCronSecret()).toBe('x'.repeat(32));
  });

  it.each([undefined, '', 'x'.repeat(31)])('fails closed on %j', (value) => {
    vi.stubEnv('CRON_SECRET', value);
    expect(() => readCronSecret()).toThrow(MissingConfigError);
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

describe('readAuthSecrets', () => {
  it('reads the app_auth password and the Better Auth secret by name', () => {
    vi.stubEnv('ARCA_DB_AUTH_PASSWORD', 'test-only-password');
    vi.stubEnv('BETTER_AUTH_SECRET', 's'.repeat(32));
    expect(readAuthSecrets()).toEqual({
      databasePassword: 'test-only-password',
      secret: 's'.repeat(32),
    });
  });

  it.each([undefined, '', 's'.repeat(31)])('fails closed on a secret of %j', (value) => {
    vi.stubEnv('ARCA_DB_AUTH_PASSWORD', 'test-only-password');
    vi.stubEnv('BETTER_AUTH_SECRET', value);
    expect(() => readAuthSecrets()).toThrow(MissingConfigError);
  });

  it('fails without the app_auth password', () => {
    vi.stubEnv('ARCA_DB_AUTH_PASSWORD', undefined);
    vi.stubEnv('BETTER_AUTH_SECRET', 's'.repeat(32));
    expect(() => readAuthSecrets()).toThrow('ARCA_DB_AUTH_PASSWORD is not set');
  });
});

describe('readAuthOrigin', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL', '1');
  });

  it('uses the branch URL on a preview, never the deployment URL', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_BRANCH_URL', 'arca-git-feature-team.vercel.app');
    vi.stubEnv('VERCEL_URL', 'arca-abc123-team.vercel.app');
    expect(readAuthOrigin()).toBe('https://arca-git-feature-team.vercel.app');
  });

  it('uses the production domain in production', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'arca.example.com');
    expect(readAuthOrigin()).toBe('https://arca.example.com');
  });

  it('uses the local dev server outside Vercel', () => {
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(readAuthOrigin()).toBe('http://localhost:3000');
  });

  it('uses the local dev server under vercel dev', () => {
    vi.stubEnv('VERCEL_ENV', 'development');
    expect(readAuthOrigin()).toBe('http://localhost:3000');
  });

  it.each([undefined, '', 'staging'])('fails closed on Vercel with VERCEL_ENV %j', (value) => {
    vi.stubEnv('VERCEL_ENV', value);
    expect(() => readAuthOrigin()).toThrow(MissingConfigError);
  });

  it.each([undefined, '', 'evil.example.com/path', 'user@host.example.com', 'host:8443'])(
    'fails closed on a preview host of %j',
    (value) => {
      vi.stubEnv('VERCEL_ENV', 'preview');
      vi.stubEnv('VERCEL_BRANCH_URL', value);
      expect(() => readAuthOrigin()).toThrow(MissingConfigError);
    },
  );
});

describe('readDeploymentEnvironment', () => {
  it('is development off Vercel, whatever VERCEL_ENV says', () => {
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(readDeploymentEnvironment()).toBe('development');
  });

  it.each(['production', 'preview', 'development'])('reads %s on Vercel', (value) => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', value);
    expect(readDeploymentEnvironment()).toBe(value);
  });

  it.each([undefined, '', 'staging'])('fails closed on Vercel with VERCEL_ENV %j', (value) => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', value);
    expect(() => readDeploymentEnvironment()).toThrow(MissingConfigError);
  });
});
