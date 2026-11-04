import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  databaseTargetFrom,
  hostNamePattern,
  MissingConfigError,
  readApiSecrets,
  readAuthOrigin,
  readDeploymentEnvironment,
  readAuthSecrets,
  readCronSecret,
  readEnrollmentCodeHash,
  readJobsDatabasePassword,
  readRateLimitKey,
  readResendKey,
} from '../src/config.js';
import { productionSite } from '../src/production-site.js';

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

describe('readRateLimitKey (spec 0003, R10)', () => {
  it('reads a key of 32 characters or more', () => {
    vi.stubEnv('ARCA_RATE_LIMIT_KEY', 'k'.repeat(32));
    expect(readRateLimitKey()).toBe('k'.repeat(32));
  });

  it.each([undefined, '', 'k'.repeat(31)])('fails closed on %j', (value) => {
    vi.stubEnv('ARCA_RATE_LIMIT_KEY', value);
    expect(() => readRateLimitKey()).toThrow(MissingConfigError);
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

  it('uses the host the site file names in production (spec 0003, R9)', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'arca-team.vercel.app');
    expect(readAuthOrigin({ host: 'arca.example.com', senderDomain: null })).toBe(
      'https://arca.example.com',
    );
    expect(readAuthOrigin()).toBe('https://arca.filx.app');
  });

  it('falls back to the production URL while the site file names no host', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'arca.example.com');
    expect(readAuthOrigin({ host: null, senderDomain: null })).toBe('https://arca.example.com');
  });

  it('refuses a site host that is not a host name', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(() => readAuthOrigin({ host: 'arca.example.com/x', senderDomain: null })).toThrow(
      MissingConfigError,
    );
  });

  it('uses the local dev server outside Vercel', () => {
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(readAuthOrigin()).toBe('http://localhost:3000');
  });

  it('takes another local port from ARCA_LOCAL_ORIGIN', () => {
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('ARCA_LOCAL_ORIGIN', 'http://localhost:4174');
    expect(readAuthOrigin()).toBe('http://localhost:4174');
  });

  it.each([
    'http://127.0.0.1:4174',
    'https://localhost:4174',
    'http://evil.example:80',
    'http://localhost',
  ])('refuses ARCA_LOCAL_ORIGIN %s', (value) => {
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('ARCA_LOCAL_ORIGIN', value);
    expect(() => readAuthOrigin()).toThrow(MissingConfigError);
  });

  it('ignores ARCA_LOCAL_ORIGIN on a preview', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_BRANCH_URL', 'arca-git-feature-team.vercel.app');
    vi.stubEnv('ARCA_LOCAL_ORIGIN', 'http://localhost:4174');
    expect(readAuthOrigin()).toBe('https://arca-git-feature-team.vercel.app');
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

describe('the production site file (spec 0003, R9)', () => {
  it('names host names only', () => {
    for (const name of [productionSite.host, productionSite.senderDomain]) {
      if (name !== null) expect(name).toMatch(hostNamePattern);
    }
  });
});

describe('readResendKey', () => {
  it.each([
    [undefined, undefined],
    ['', undefined],
    ['not-a-key', undefined],
    ['re_abc DEF', undefined],
    [' re_abc_DEF-1\n', 're_abc_DEF-1'],
  ])('reads %j as %j', (value, expected) => {
    vi.stubEnv('RESEND_API_KEY', value);
    expect(readResendKey()).toBe(expected);
  });
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

  it('accepts a VERCEL_TARGET_ENV that matches VERCEL_ENV', () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_TARGET_ENV', 'preview');
    expect(readDeploymentEnvironment()).toBe('preview');
  });

  it('fails closed on a custom environment, which Vercel reports as a preview', () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
    expect(() => readDeploymentEnvironment()).toThrow(MissingConfigError);
  });
});

describe('readEnrollmentCodeHash (spec 0003, R2)', () => {
  const hash = 'a'.repeat(64);

  it('keeps owner enrollment closed until a hash is committed', () => {
    expect(readEnrollmentCodeHash('production')).toBeNull();
  });

  it('takes a local hash only in development', () => {
    vi.stubEnv('ARCA_ENROLLMENT_CODE_HASH', hash);
    expect(readEnrollmentCodeHash('development')).toBe(hash);
    expect(readEnrollmentCodeHash('preview')).toBeNull();
    expect(readEnrollmentCodeHash('production')).toBeNull();
  });

  it('refuses a value that is not a SHA-256 hex digest', () => {
    vi.stubEnv('ARCA_ENROLLMENT_CODE_HASH', 'A'.repeat(64));
    expect(() => readEnrollmentCodeHash('development')).toThrow(MissingConfigError);
  });
});
