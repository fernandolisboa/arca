import type { CaseView } from '@arca/api-contract/routes';
import type { Logger } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { SignedIn } from '../src/auth/service.js';
import type { StepUpService } from '../src/auth/step-up.js';
import type { CanonicalAction } from '../src/auth/step-up-encoding.js';
import type { CaseFiles, CaseRefusal, CaseWritten } from '../src/case/case-files.js';
import { noLimits } from './limits.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const owner: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const session = {
  accountId: owner.accountId,
  email: 'owner@example.com',
  confirmed: true,
  device: { browser: 'firefox' as const, os: 'linux' as const },
};
const nonce = 'MzMzMzMzMzMzMzMzMzMzMw';
const me = '0b9c3d6e-1f2a-4b5c-8d7e-9f0a1b2c3d4e';
const child = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const relative = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const assetId = 'c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f';
const house = { kind: 'cash', value: { amount: 100, currency: 'BRL' }, valuedAt: '2026-01-10' };

const view: CaseView = {
  caseId: '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a',
  me,
  people: [
    {
      id: me,
      displayName: 'Alice',
      caseMember: true,
      accountId: owner.accountId,
      keptByMe: true,
      profile: null,
      finances: null,
      shares: { profile: [], finances: [] },
      sharedWithMe: [],
    },
  ],
  relationships: [],
  assets: [],
};

/** Each write route, its body, and the call it makes on the case. */
const writes: readonly [string, unknown, string, unknown][] = [
  ['/case', { displayName: 'Alice' }, 'create', 'Alice'],
  [
    '/case/people',
    { displayName: 'Criança', caseMember: true },
    'addPerson',
    { displayName: 'Criança', caseMember: true },
  ],
  [
    '/case/people/update',
    { personId: child, displayName: 'Filha', caseMember: true },
    'updatePerson',
    { personId: child, displayName: 'Filha', caseMember: true },
  ],
  ['/case/people/remove', { personId: child }, 'removePerson', child],
  [
    '/case/members',
    { accountId: relative, displayName: 'Tia' },
    'addMember',
    { accountId: relative, displayName: 'Tia' },
  ],
  [
    '/case/people/profile',
    { personId: child, facts: { studying: true }, dependsOn: null },
    'writeProfile',
    { personId: child, facts: { studying: true }, dependsOn: null },
  ],
  [
    '/case/people/finances',
    { personId: child, assetsRecordedInFull: false },
    'writeFinances',
    { personId: child, assetsRecordedInFull: false },
  ],
  [
    '/case/people/shares',
    { personId: child, profile: [relative], finances: [] },
    'replaceShares',
    { personId: child, profile: [relative], finances: [] },
  ],
  [
    '/case/relationships',
    { kind: 'parent', from: me, to: child, details: {} },
    'addRelationship',
    { kind: 'parent', from: me, to: child, details: {} },
  ],
  ['/case/relationships/remove', { relationshipId: assetId }, 'removeRelationship', assetId],
  [
    '/case/assets',
    { personId: me, share: '1', asset: house },
    'addAsset',
    { personId: me, share: '1', asset: house },
  ],
  ['/case/assets/update', { assetId, asset: house }, 'updateAsset', { assetId, asset: house }],
  ['/case/assets/remove', { assetId }, 'removeAsset', assetId],
  [
    '/case/assets/owners',
    { assetId, personId: child, share: '0.5' },
    'setOwner',
    { assetId, personId: child, share: '0.5' },
  ],
  [
    '/case/assets/owners/confirm',
    { assetId, personId: child },
    'confirmOwner',
    { assetId, personId: child },
  ],
  [
    '/case/assets/owners/remove',
    { assetId, personId: child },
    'removeOwner',
    { assetId, personId: child },
  ],
];

function setup({
  confirmedAccount = true,
  allowed = true,
  approved = true,
  outcome = { ok: true, view },
  left = 'left',
}: {
  confirmedAccount?: boolean;
  allowed?: boolean;
  approved?: boolean;
  outcome?: CaseWritten;
  left?: 'left' | 'not_found';
} = {}) {
  const calls: unknown[][] = [];
  const spent: { purpose: string; action: CanonicalAction }[] = [];
  const limited: string[] = [];
  const stepUp: StepUpService = {
    options: () => Promise.reject(new Error('unused')),
    verify: () => Promise.reject(new Error('unused')),
    consume: (_, purpose, action) => {
      spent.push({ purpose, action });
      return Promise.resolve(approved);
    },
    vaultUnlocked: () => Promise.resolve(false),
  };
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return Promise.resolve(outcome);
    };
  const cases = {
    view: (accountId: string) => {
      calls.push(['view', accountId]);
      return Promise.resolve(view);
    },
    leave: (accountId: string) => {
      calls.push(['leave', accountId]);
      return Promise.resolve(left);
    },
    ...Object.fromEntries(
      [...writes.map(([, , method]) => method), 'handOver'].map((method) => [
        method,
        record(method),
      ]),
    ),
  } as unknown as CaseFiles;
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(owner),
      refresh: () => Promise.resolve({ session, setCookies: [] }),
    },
    authLimits: {
      ...noLimits,
      limiter: {
        hit: (rule) => {
          limited.push(rule.name);
          return Promise.resolve(allowed ? { allowed } : { allowed, retryAfterSeconds: 60 });
        },
      },
    },
    stepUp,
    cases,
    accountConfirmed: () => Promise.resolve(confirmedAccount),
  });
  const call = (method: 'GET' | 'POST', path: string, body?: unknown) =>
    app.request(`/v1${path}`, {
      method,
      headers: {
        origin,
        cookie: 'session=1',
        'content-type': 'application/json',
        'arca-step-up-nonce': nonce,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { call, calls, limited, spent };
}

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('the case routes (spec 0007, R3)', () => {
  it('reads the case without counting a write', async () => {
    const { call, calls, limited } = setup();
    const response = await call('GET', '/case');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ case: view });
    expect(calls).toEqual([['view', owner.accountId]]);
    expect(limited).toEqual([]);
  });

  it.each(writes)(
    'POST %s calls the case and answers its view',
    async (path, body, method, arg) => {
      const { call, calls, limited } = setup();
      const response = await call('POST', path, body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ case: view });
      expect(calls).toEqual([[method, owner.accountId, arg]]);
      expect(limited).toEqual(['case_write_account']);
    },
  );

  it.each(writes)(
    'POST %s refuses an unconfirmed account and a write over the limit',
    async (path, body) => {
      for (const [options, status, code] of [
        [{ confirmedAccount: false }, 403, 'account_unconfirmed'],
        [{ allowed: false }, 429, 'rate_limited'],
      ] as const) {
        const { call, calls } = setup(options);
        const response = await call('POST', path, body);
        expect(response.status).toBe(status);
        expect(await errorOf(response)).toBe(code);
        expect(calls).toEqual([]);
      }
    },
  );

  it.each([
    ['not_found', 404],
    ['case_exists', 409],
    ['case_limit', 409],
    ['case_invalid', 409],
  ] as [CaseRefusal, number][])('answers a %s refusal with %i', async (reason, status) => {
    const response = await setup({ outcome: { ok: false, reason } }).call('POST', '/case/people', {
      displayName: 'Tio',
      caseMember: false,
    });
    expect(response.status).toBe(status);
    expect(await errorOf(response)).toBe(reason);
  });

  it('refuses a body outside the storage schemas', async () => {
    for (const [path, body] of [
      ['/case', { displayName: ' Alice' }],
      ['/case/people/profile', { personId: child, facts: { name: 'Alice' }, dependsOn: null }],
      ['/case/assets/owners', { assetId, personId: child, share: '1.5' }],
      ['/case/relationships', { kind: 'parent', from: me, to: me, details: {} }],
    ] as const) {
      const { call, calls } = setup();
      expect((await call('POST', path, body)).status, path).toBe(400);
      expect(calls).toEqual([]);
    }
  });

  it('hands a person over only with a sensitive_settings step-up for the person and account', async () => {
    const body = { personId: child, accountId: relative };
    const granted = setup();
    expect((await granted.call('POST', '/case/people/hand-over', body)).status).toBe(200);
    expect(
      granted.spent.map(({ purpose, action }) => [purpose, action.action, action.targets]),
    ).toEqual([['sensitive_settings', 'handOverCasePerson', [child, relative]]]);
    expect(granted.calls).toEqual([['handOver', owner.accountId, body]]);

    const refused = setup({ approved: false });
    const response = await refused.call('POST', '/case/people/hand-over', body);
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('step_up_required');
    expect(refused.calls).toEqual([]);
  });

  it('adds a member taking over a person only with a sensitive_settings step-up for both', async () => {
    const body = { accountId: relative, personId: child };
    const granted = setup();
    expect((await granted.call('POST', '/case/members', body)).status).toBe(200);
    expect(
      granted.spent.map(({ purpose, action }) => [purpose, action.action, action.targets]),
    ).toEqual([['sensitive_settings', 'addCaseMember', [child, relative]]]);
    expect(granted.calls).toEqual([['addMember', owner.accountId, body]]);

    const refused = setup({ approved: false });
    const response = await refused.call('POST', '/case/members', body);
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('step_up_required');
    expect(refused.calls).toEqual([]);

    const named = setup({ approved: false });
    const both = { accountId: relative, personId: child, displayName: 'Tia' };
    expect((await named.call('POST', '/case/members', both)).status).toBe(400);
    expect(named.spent).toEqual([]);
  });

  it('leaves the case only with a sensitive_settings step-up', async () => {
    const granted = setup();
    const response = await granted.call('POST', '/case/leave', {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(
      granted.spent.map(({ purpose, action }) => [purpose, action.action, action.targets]),
    ).toEqual([['sensitive_settings', 'leaveCase', []]]);
    expect(granted.calls).toEqual([['leave', owner.accountId]]);

    expect((await setup({ approved: false }).call('POST', '/case/leave', {})).status).toBe(403);
    const outside = await setup({ left: 'not_found' }).call('POST', '/case/leave', {});
    expect(outside.status).toBe(404);
  });
});
