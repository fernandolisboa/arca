import { createApiClient, routes, type SessionResponse } from '@arca/api-contract/client';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AuthService } from '../src/auth/service.js';
import type { Logger } from '../src/logger.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };

/** Synthetic only: an address on a reserved domain. */
const signedIn: SessionResponse = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  email: 'owner@example.com',
  device: { browser: 'firefox', os: 'linux' },
};

function setup(session: SessionResponse | null = null) {
  const handled: string[] = [];
  const auth: AuthService = {
    handle: (request) => {
      handled.push(`${request.method} ${new URL(request.url).pathname}`);
      return Promise.resolve(Response.json({ success: true }));
    },
    session: () => Promise.resolve(session),
  };
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    auth,
  });
  const client = createApiClient({
    origin: 'http://arca.test',
    fetch: (input, init) => Promise.resolve(app.request(input, init)),
  });
  return { app, client, handled };
}

describe('the Better Auth allow-list (spec 0003, R1)', () => {
  it.each([
    ['email and password sign-in', 'POST', '/v1/auth/sign-in/email'],
    ['email and password sign-up', 'POST', '/v1/auth/sign-up/email'],
    ['a password reset', 'POST', '/v1/auth/request-password-reset'],
    ['magic-link sign-in', 'POST', '/v1/auth/sign-in/magic-link'],
    ['magic-link verification', 'GET', '/v1/auth/magic-link/verify'],
    ['social sign-in', 'POST', '/v1/auth/sign-in/social'],
    ['a social callback', 'GET', '/v1/auth/callback/google'],
    ['anonymous sign-in', 'POST', '/v1/auth/sign-in/anonymous'],
    ['changing the email address', 'POST', '/v1/auth/change-email'],
    ['reading the session through Better Auth', 'GET', '/v1/auth/get-session'],
    ['the passkey registration options', 'GET', '/v1/auth/passkey/generate-register-options'],
    ['the auth root', 'GET', '/v1/auth'],
    ['sign-out with the wrong method', 'GET', '/v1/auth/sign-out'],
    ['sign-out with a trailing slash', 'POST', '/v1/auth/sign-out/'],
    ['sign-out with a doubled slash', 'POST', '/v1/auth//sign-out'],
    ['sign-out with an encoded character', 'POST', '/v1/auth/sign%2Dout'],
    ['sign-out in another case', 'POST', '/v1/auth/Sign-Out'],
  ])('answers 404 to %s before Better Auth sees it', async (_label, method, path) => {
    const { app, handled } = setup();
    const response = await app.request(path, { method });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'not_found' } });
    expect(handled).toEqual([]);
  });

  it('hands an allow-listed endpoint to Better Auth unchanged', async () => {
    const { client, handled } = setup();
    await expect(client.call(routes.signOut, {})).resolves.toEqual({ success: true });
    expect(handled).toEqual(['POST /v1/auth/sign-out']);
  });

  it('answers 404 to every auth path when Better Auth is not configured', async () => {
    const app = createApp({ checkDatabase: () => Promise.resolve('ok'), logger: silentLogger });
    expect((await app.request('/v1/auth/sign-out', { method: 'POST' })).status).toBe(404);
  });
});

describe('GET /v1/session', () => {
  it('returns the account and device of the session, matching the contract', async () => {
    const { client } = setup(signedIn);
    await expect(client.call(routes.session)).resolves.toEqual(signedIn);
  });

  it('answers 401 without a session', async () => {
    const { app } = setup();
    const response = await app.request('/v1/session');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'unauthorized' } });
  });

  it('answers 401 when Better Auth is not configured', async () => {
    const app = createApp({ checkDatabase: () => Promise.resolve('ok'), logger: silentLogger });
    expect((await app.request('/v1/session')).status).toBe(401);
  });
});

describe('GET /v1/audit/events', () => {
  const page = {
    events: [
      {
        id: '0e1d2c3b-4a59-4687-9a6b-5c4d3e2f1a0b',
        time: '2026-11-04T01:00:00.000Z',
        code: 'sign_in' as const,
        actorAccountId: signedIn.accountId,
        details: { browser: 'firefox', os: 'linux' },
      },
    ],
    next: null,
  };

  function withAudit(session: SessionResponse | null) {
    const asked: unknown[] = [];
    const app = createApp({
      checkDatabase: () => Promise.resolve('ok'),
      logger: silentLogger,
      auth: {
        handle: () => Promise.resolve(new Response(null, { status: 500 })),
        session: () => Promise.resolve(session),
      },
      audit: {
        events: (accountId, query) => {
          asked.push({ accountId, query });
          return Promise.resolve(page);
        },
      },
    });
    const client = createApiClient({
      origin: 'http://arca.test',
      fetch: (input, init) => Promise.resolve(app.request(input, init)),
    });
    return { app, client, asked };
  }

  it("reads the signed-in account's events, matching the contract", async () => {
    const { client, asked } = withAudit(signedIn);
    await expect(client.call(routes.auditEvents, { limit: 10 })).resolves.toEqual(page);
    expect(asked).toEqual([{ accountId: signedIn.accountId, query: { limit: 10 } }]);
  });

  it('answers 401 without a session', async () => {
    const { app, asked } = withAudit(null);
    expect((await app.request('/v1/audit/events')).status).toBe(401);
    expect(asked).toEqual([]);
  });

  it.each(['?limit=0', '?limit=101', '?limit=x', '?before=not-a-uuid'])(
    'answers 400 to the query %s',
    async (query) => {
      const { app, asked } = withAudit(signedIn);
      expect((await app.request(`/v1/audit/events${query}`)).status).toBe(400);
      expect(asked).toEqual([]);
    },
  );
});
