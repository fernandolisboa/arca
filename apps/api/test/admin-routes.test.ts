import { stepUpNonceHeader } from '@arca/api-contract/routes';
import type { Logger } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { SignedIn } from '../src/auth/service.js';
import type { AdminChangeOutcome, AdminGrants } from '../src/knowledge/admin-grants.js';
import { noLimits } from './limits.js';

// The admin role's routes (ADR-0027), on a fake service. Synthetic IDs only.
const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const admin: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const grantee = '7b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b';
const nonce = 'AAAAAAAAAAAAAAAAAAAAAA';

function setup({
  signedIn = admin,
  confirmed = true,
  outcome = 'changed',
  listed = [{ accountId: admin.accountId, onOwnerList: true }],
}: {
  signedIn?: SignedIn | null;
  confirmed?: boolean;
  outcome?: AdminChangeOutcome;
  listed?: Awaited<ReturnType<AdminGrants['list']>>;
} = {}) {
  const calls: unknown[][] = [];
  const admins: AdminGrants = {
    isAdmin: () => Promise.resolve(true),
    list: (accountId) => {
      calls.push(['list', accountId]);
      return Promise.resolve(listed);
    },
    grant: (who, accountId, actionNonce) => {
      calls.push(['grant', who, accountId, Buffer.from(actionNonce).toString('base64url')]);
      return Promise.resolve(outcome);
    },
    remove: (who, accountId) => {
      calls.push(['remove', who, accountId]);
      return Promise.resolve(outcome);
    },
  };
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(signedIn),
      refresh: () => Promise.resolve({ session: null, setCookies: [] }),
    },
    authLimits: noLimits,
    accountConfirmed: () => Promise.resolve(confirmed),
    admins,
  });
  const change = (
    kind: 'grant' | 'remove',
    body: unknown = { accountId: grantee },
    headers: Record<string, string> = { origin, [stepUpNonceHeader]: nonce },
  ) =>
    app.request(`/v1/admins/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return { app, change, calls };
}

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('GET /v1/admins (ADR-0027)', () => {
  it("lists the case's admins for an admin", async () => {
    const { app, calls } = setup();
    const response = await app.request('/v1/admins');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      admins: [{ accountId: admin.accountId, onOwnerList: true }],
    });
    expect(calls).toEqual([['list', admin.accountId]]);
  });

  it.each([
    ['not_admin', 403],
    ['not_found', 404],
  ] as const)('answers %s with %i', async (refused, status) => {
    const response = await setup({ listed: refused }).app.request('/v1/admins');
    expect(response.status).toBe(status);
    expect(await errorOf(response)).toBe(refused);
  });

  it('answers 401 signed out and 403 to an unconfirmed account, listing nothing', async () => {
    const signedOut = setup({ signedIn: null });
    expect((await signedOut.app.request('/v1/admins')).status).toBe(401);
    const unconfirmed = setup({ confirmed: false });
    const response = await unconfirmed.app.request('/v1/admins');
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('account_unconfirmed');
    expect([...signedOut.calls, ...unconfirmed.calls]).toEqual([]);
  });
});

describe('POST /v1/admins/grant and /remove (ADR-0027)', () => {
  it('gives the role with the nonce the client sent for its step-up', async () => {
    const { change, calls } = setup();
    const response = await change('grant');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(calls).toEqual([['grant', admin, grantee, nonce]]);
  });

  it('refuses to give the role with no step-up nonce, asking the service nothing', async () => {
    const { change, calls } = setup();
    const response = await change('grant', { accountId: grantee }, { origin });
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('step_up_required');
    expect(calls).toEqual([]);
  });

  it('takes the role away with no step-up', async () => {
    const { change, calls } = setup();
    const response = await change('remove', { accountId: grantee }, { origin });
    expect(response.status).toBe(200);
    expect(calls).toEqual([['remove', admin, grantee]]);
  });

  it.each<[AdminChangeOutcome, number]>([
    ['unchanged', 200],
    ['not_admin', 403],
    ['step_up_required', 403],
    ['not_found', 404],
    ['owner_list_admin', 409],
  ])('answers %s with %i', async (outcome, status) => {
    const response = await setup({ outcome }).change('remove');
    expect(response.status).toBe(status);
    if (status !== 200) expect(await errorOf(response)).toBe(outcome);
  });

  it('answers 400 for a malformed account or a body with more than the account', async () => {
    const { change, calls } = setup();
    expect((await change('grant', { accountId: 'not-an-id' })).status).toBe(400);
    expect((await change('remove', { accountId: grantee, owner: true })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it.each([
    ['another origin', { origin: 'https://evil.test' }],
    ['a cross-site fetch with no origin', { 'sec-fetch-site': 'cross-site' }],
  ])('refuses a change from %s, changing nothing', async (_name, headers) => {
    const { change, calls } = setup();
    for (const kind of ['grant', 'remove'] as const) {
      const response = await change(kind, { accountId: grantee }, headers);
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toBe('cross_origin');
    }
    expect(calls).toEqual([]);
  });

  it('answers 401 signed out and 403 to an unconfirmed account, changing nothing', async () => {
    const signedOut = setup({ signedIn: null });
    expect((await signedOut.change('grant')).status).toBe(401);
    const unconfirmed = setup({ confirmed: false });
    expect(await errorOf(await unconfirmed.change('remove'))).toBe('account_unconfirmed');
    expect([...signedOut.calls, ...unconfirmed.calls]).toEqual([]);
  });
});
