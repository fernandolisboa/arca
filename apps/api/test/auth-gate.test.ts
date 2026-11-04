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

const origin = 'http://arca.test';

function setup(
  session: SessionResponse | null = null,
  answer: () => Response = () => Response.json({ success: true }),
) {
  const handled: string[] = [];
  const auth: AuthService = {
    handle: (request) => {
      handled.push(`${request.method} ${new URL(request.url).pathname}`);
      return Promise.resolve(answer());
    },
    session: () => Promise.resolve(session),
    refresh: () =>
      Promise.resolve({ session, setCookies: session === null ? [] : ['__Host-arca.slid=1'] }),
  };
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth,
  });
  // A browser sends Origin on every state-changing request.
  const client = createApiClient({
    origin,
    fetch: (input, init) => {
      const request = new Request(input, init);
      request.headers.set('origin', origin);
      return Promise.resolve(app.request(request));
    },
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
    const response = await app.request(path, { method, headers: { origin } });
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
    const app = createApp({
      checkDatabase: () => Promise.resolve('ok'),
      logger: silentLogger,
      origin,
    });
    const response = await app.request('/v1/auth/sign-out', {
      method: 'POST',
      headers: { origin },
    });
    expect(response.status).toBe(404);
  });

  it('lets through the passkey sign-in endpoints', async () => {
    const { app, handled } = setup(null, () => Response.json({}));
    await app.request('/v1/auth/passkey/generate-authenticate-options');
    await app.request('/v1/auth/passkey/verify-authentication', {
      method: 'POST',
      headers: { origin },
    });
    expect(handled).toEqual([
      'GET /v1/auth/passkey/generate-authenticate-options',
      'POST /v1/auth/passkey/verify-authentication',
    ]);
  });
});

describe("Better Auth's answers, re-encoded through the contract", () => {
  it('drops every field outside the contract, so no session token reaches a body', async () => {
    const { app } = setup(null, () => {
      const response = Response.json({
        session: { token: 'test-only-token', userId: signedIn.accountId },
        user: { email: 'owner@example.com' },
      });
      response.headers.append('set-cookie', '__Host-arca.session_token=x; Path=/; Secure');
      return response;
    });
    const response = await app.request('/v1/auth/passkey/verify-authentication', {
      method: 'POST',
      headers: { origin },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(response.headers.getSetCookie()).toEqual([
      '__Host-arca.session_token=x; Path=/; Secure',
    ]);
  });

  it("answers our error code, never Better Auth's message", async () => {
    const { app } = setup(null, () =>
      Response.json({ code: 'PASSKEY_NOT_FOUND', message: 'Passkey not found' }, { status: 401 }),
    );
    const response = await app.request('/v1/auth/passkey/verify-authentication', {
      method: 'POST',
      headers: { origin },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'unauthorized' } });
  });

  it('forces user verification into the sign-in options it passes on', async () => {
    const { app } = setup(null, () =>
      Response.json({ challenge: 'abc', rpId: 'arca.test', userVerification: 'required' }),
    );
    const response = await app.request('/v1/auth/passkey/generate-authenticate-options');
    expect(await response.json()).toEqual({
      challenge: 'abc',
      rpId: 'arca.test',
      userVerification: 'required',
    });
  });
});

describe('the origin check on state-changing /v1 routes (spec 0003, R4)', () => {
  const signOut = (headers: Record<string, string>) =>
    setup().app.request('/v1/auth/sign-out', { method: 'POST', headers });

  it.each([
    ['a sibling filx.app origin', { origin: 'https://other.filx.app' }],
    ['another scheme', { origin: 'https://arca.test' }],
    ['a null origin', { origin: 'null' }],
    ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
    ['a same-site fetch from a sibling subdomain', { 'sec-fetch-site': 'same-site' }],
    ['neither header', {}],
  ])('refuses %s', async (_label, headers) => {
    const response = await signOut(headers);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'cross_origin' } });
  });

  it.each([
    ['the exact origin', { origin }],
    ['a same-origin fetch without Origin', { 'sec-fetch-site': 'same-origin' }],
  ])('allows %s', async (_label, headers) => {
    expect((await signOut(headers)).status).toBe(200);
  });

  it('refuses even the exact origin when the app has no origin configured', async () => {
    const app = createApp({ checkDatabase: () => Promise.resolve('ok'), logger: silentLogger });
    const response = await app.request('/v1/auth/sign-out', {
      method: 'POST',
      headers: { origin },
    });
    expect(response.status).toBe(403);
  });

  it('leaves reads alone', async () => {
    expect((await setup().app.request('/v1/session')).status).toBe(401);
  });
});

describe('GET /v1/session', () => {
  it('returns the account and device of the session, matching the contract', async () => {
    const { client } = setup(signedIn);
    await expect(client.call(routes.session)).resolves.toEqual(signedIn);
  });

  it('passes on the cookies of the slid expiry', async () => {
    const response = await setup(signedIn).app.request('/v1/session');
    expect(response.headers.getSetCookie()).toEqual(['__Host-arca.slid=1']);
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
        refresh: () => Promise.resolve({ session, setCookies: [] }),
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

describe('/internal/outbox', () => {
  const messages = [
    { to: 'owner@example.com', subject: 's', text: 't', sentAt: '2026-11-04T01:00:00.000Z' },
  ];

  it('lists the outbox when the deployment gives it one', async () => {
    const app = createApp({
      checkDatabase: () => Promise.resolve('ok'),
      logger: silentLogger,
      outbox: () => Promise.resolve(messages),
    });
    const response = await app.request('/internal/outbox');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ messages });
  });

  it('answers 404 everywhere else', async () => {
    const app = createApp({ checkDatabase: () => Promise.resolve('ok'), logger: silentLogger });
    expect((await app.request('/internal/outbox')).status).toBe(404);
  });
});
