import type { Database } from '@arca/db';
import { describe, expect, it } from 'vitest';
import { createAuth } from '../src/auth/auth.js';
import type { Logger } from '../src/logger.js';

const lines: unknown[] = [];
const logger: Logger = { info: (entry) => lines.push(entry), error: (entry) => lines.push(entry) };

// Never queried: these tests read the configuration only.
const auth = createAuth({
  db: {} as Database,
  secret: 'test-only-secret-'.padEnd(32, 'x'),
  origin: 'https://preview.example.com',
  logger,
});

describe('the Better Auth configuration (spec 0003, R1)', () => {
  it('turns telemetry off', () => {
    expect(auth.options.telemetry).toEqual({ enabled: false });
  });

  it('configures passkeys and nothing else that signs in', () => {
    expect(auth.options.emailAndPassword).toEqual({ enabled: false });
    expect('socialProviders' in auth.options).toBe(false);
    expect(auth.options.plugins.map((plugin) => plugin.id)).toEqual(['passkey']);
    expect(auth.options.user.changeEmail).toEqual({ enabled: false });
  });

  it('trusts only the environment origin and binds passkeys to its host', () => {
    expect(auth.options.baseURL).toBe('https://preview.example.com');
    expect(auth.options.trustedOrigins).toEqual(['https://preview.example.com']);
    expect(auth.options.basePath).toBe('/v1/auth');
  });

  it('logs only the level of a Better Auth message', () => {
    lines.length = 0;
    const log = auth.options.logger.log as (level: string, ...rest: unknown[]) => void;
    log('error', 'Failed for owner@example.com', { email: 'x@example.com' });
    expect(lines).toEqual([{ errorName: 'BetterAuthError' }]);
  });
});
