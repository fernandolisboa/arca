import type { Database } from '@arca/db';
import { describe, expect, it } from 'vitest';
import { createAuth } from '../src/auth/auth.js';
import { ownerCode } from '../src/auth/enrollment.js';
import { registrationHooks } from '../src/auth/registration.js';
import type { Logger } from '@arca/telemetry';
import { allowAll } from './limits.js';

const lines: unknown[] = [];
const logger: Logger = { info: (entry) => lines.push(entry), error: (entry) => lines.push(entry) };

// Never queried: these tests read the configuration only.
const audit = { record: () => Promise.resolve() };
const auth = createAuth({
  db: {} as Database,
  registration: registrationHooks({ db: {} as Database, audit, ownerCode: ownerCode(null) }),
  secret: 'test-only-secret-'.padEnd(32, 'x'),
  origin: 'https://preview.example.com',
  logger,
  audit,
  notices: { send: () => Promise.resolve() },
  limiter: allowAll,
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
    log('warn', 'Odd request from owner@example.com');
    expect(lines).toEqual([{ errorName: 'BetterAuthError' }, { errorName: 'BetterAuthWarning' }]);
  });

  const before = auth.options.databaseHooks.session.create.before as unknown as (
    session: Record<string, unknown>,
    context: { path?: string; body?: unknown; headers: Headers } | null,
  ) => Promise<{ data: Record<string, unknown> }>;
  const signIn = { path: '/passkey/verify-authentication', body: { response: { id: 'cred-1' } } };

  it('stores no network details and derives the device from the user agent', async () => {
    const headers = new Headers({
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0',
      'x-forwarded-for': '192.0.2.10',
    });
    const { data } = await before(
      { userId: 'u', ipAddress: '192.0.2.10', userAgent: 'raw agent' },
      { ...signIn, headers },
    );
    expect(data).toEqual({
      userId: 'u',
      ipAddress: null,
      userAgent: null,
      deviceBrowser: 'firefox',
      deviceOs: 'linux',
      credentialId: 'cred-1',
    });
  });

  it.each([
    ['no endpoint at all', null],
    ['another endpoint', { path: '/sign-in/email', body: {}, headers: new Headers() }],
    [
      'a sign-in without a credential',
      { path: '/passkey/verify-authentication', body: {}, headers: new Headers() },
    ],
  ])('refuses a session from %s', async (_label, context) => {
    await expect(before({ userId: 'u' }, context)).rejects.toThrow();
  });
});

describe('passkey registration (spec 0003, R2 and R3)', () => {
  const [plugin] = auth.options.plugins;
  const options = (plugin as unknown as { options: Record<string, unknown> }).options;

  it('asks for a discoverable credential, user verification and PRF support', () => {
    expect(options['authenticatorSelection']).toEqual({
      residentKey: 'required',
      userVerification: 'required',
    });
    expect(options['registration']).toMatchObject({
      requireSession: false,
      extensions: { prf: {} },
    });
  });

  it('refuses a registration session without a registered passkey', async () => {
    const before = auth.options.databaseHooks.session.create.before as unknown as (
      session: Record<string, unknown>,
      context: { path: string; body: unknown; headers: Headers },
    ) => Promise<unknown>;
    await expect(
      before(
        { userId: 'u' },
        {
          path: '/passkey/verify-registration',
          body: { response: { id: 'cred-1' } },
          headers: new Headers(),
        },
      ),
    ).rejects.toThrow();
  });
});

describe('cookies and session lifetimes (spec 0003, R4)', () => {
  it('names every cookie __Host- and sets its attributes', () => {
    expect(auth.options.advanced).toMatchObject({
      useSecureCookies: false,
      cookiePrefix: '__Host-arca',
      defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
    });
    expect(auth.options.advanced).not.toHaveProperty('crossSubDomainCookies');
  });

  it('expires a session after 3 idle days, slid at most daily', () => {
    expect(auth.options.session).toMatchObject({ expiresIn: 259_200, updateAge: 86_400 });
  });
});
