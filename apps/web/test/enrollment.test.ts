import { ApiError, createApiClient } from '@arca/api-contract/client';
import type { Passkeys, RegistrationResponseJSON } from '@arca/platform';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearFragment,
  groupCode,
  linkRequestFailure,
  linkTokenFrom,
  newRecoveryCode,
  registrationFailure,
} from '../src/enrollment.js';
import {
  acceptFailure,
  decideInvite,
  decisionFailure,
  inviteFrom,
  sendFailure,
} from '../src/invites.js';
import {
  addPasskey,
  deviceFailure,
  revokeOtherSessions,
  revokePasskey,
  revokeSession,
} from '../src/devices.js';
import { UnreachableError } from '../src/requests.js';
import { signOut } from '../src/sign-in.js';
import { base64url } from '../src/step-up.js';

interface Sent {
  readonly path: string;
  readonly headers: Headers;
  readonly body: unknown;
}

const sent: Sent[] = [];
let answers: Response[] = [];

vi.mock('../src/api.js', () => ({
  api: createApiClient({
    origin: 'http://arca.test',
    fetch: (input: string, init?: RequestInit) => {
      sent.push({
        path: new URL(input).pathname,
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      const answer = answers.shift();
      return answer === undefined
        ? Promise.reject(new Error('unexpected request'))
        : Promise.resolve(answer);
    },
  }),
}));

const token = 'A'.repeat(43);
const recoveryCode = '0123456789ABCDEFGHJKMNPQRS';
const assertion = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
  clientExtensionResults: {},
} as const;

function passkeysThatSign(): Passkeys {
  return {
    isAvailable: () => Promise.resolve(true),
    supportsAutofill: () => Promise.resolve(false),
    create: () => Promise.reject(new Error('unused')),
    get: () => Promise.resolve(assertion),
    cancel: () => undefined,
  };
}

beforeEach(() => {
  sent.length = 0;
  answers = [];
});

describe('the link token (spec 0003, R2)', () => {
  it('reads a 43-symbol base64url fragment, and nothing else', () => {
    expect(linkTokenFrom(`#${token}`)).toBe(token);
    expect(linkTokenFrom('')).toBeUndefined();
    expect(linkTokenFrom(`#${token}A`)).toBeUndefined();
    expect(linkTokenFrom(`#${'A'.repeat(42)}+`)).toBeUndefined();
  });

  it('clears the fragment from the address bar and keeps the history state', () => {
    const replaceState = vi.fn();
    const history = { state: { key: 'k' }, replaceState } as unknown as History;
    clearFragment({ hash: `#${token}`, pathname: '/enroll', search: '' } as Location, history);
    expect(replaceState).toHaveBeenCalledWith({ key: 'k' }, '', '/enroll');
    replaceState.mockClear();
    clearFragment({ hash: '', pathname: '/enroll', search: '' } as Location, history);
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe('the failures the enrollment screens word', () => {
  it.each([
    [new ApiError(404, 'not_found'), 'expired'],
    [new ApiError(403, 'invalid_code'), 'invalid_code'],
    [new ApiError(403, 'registration_refused'), 'refused'],
    [new ApiError(409, 'signed_in'), 'signed_in'],
    [new ApiError(429, 'rate_limited'), 'limited'],
    [new UnreachableError('offline'), 'unreachable'],
    [new DOMException('dismissed', 'NotAllowedError'), 'cancelled'],
    [new Error('anything'), 'other'],
  ])('maps %o to %s at registration', (error, failure) => {
    expect(registrationFailure(error)).toBe(failure);
  });

  it.each([
    [new ApiError(404, 'not_found'), 'not_found'],
    [new ApiError(503, 'email_unavailable'), 'email_unavailable'],
    [new ApiError(503, 'accounts_closed'), 'closed'],
    [new ApiError(403, 'invalid_code'), 'other'],
  ])('maps %o to %s on a link request', (error, failure) => {
    expect(linkRequestFailure(error)).toBe(failure);
  });
});

describe('a new recovery code (spec 0003, R6)', () => {
  it('takes the first kit with no step-up', async () => {
    answers = [Response.json({ code: recoveryCode })];
    expect(await newRecoveryCode(passkeysThatSign(), { replace: false })).toBe(recoveryCode);
    expect(sent.map(({ path }) => path)).toEqual(['/v1/account/recovery-kit']);
  });

  it('falls back to a step-up bound to the action when a kit exists', async () => {
    answers = [
      Response.json({ error: { code: 'step_up_required' } }, { status: 403 }),
      Response.json({
        challengeId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
        options: { challenge: 'Y2hhbGxlbmdl', userVerification: 'required' },
      }),
      Response.json({}),
      Response.json({ code: recoveryCode }),
    ];
    expect(await newRecoveryCode(passkeysThatSign(), { replace: false })).toBe(recoveryCode);
    expect(sent.map(({ path }) => path)).toEqual([
      '/v1/account/recovery-kit',
      '/v1/auth/step-up/options',
      '/v1/auth/step-up/verify',
      '/v1/account/recovery-kit',
    ]);
    const options = sent[1]?.body as { target: { nonce: string } };
    expect(options).toEqual({
      purpose: 'sensitive_settings',
      target: { action: 'regenerateRecoveryKit', targets: [], nonce: options.target.nonce },
    });
    expect(sent[3]?.headers.get('arca-step-up-nonce')).toBe(options.target.nonce);
    expect(sent[0]?.headers.has('arca-step-up-nonce')).toBe(false);
  });

  it('goes straight to the step-up when replacing', async () => {
    answers = [
      Response.json({
        challengeId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
        options: { challenge: 'Y2hhbGxlbmdl', userVerification: 'required' },
      }),
      Response.json({}),
      Response.json({ code: recoveryCode }),
    ];
    await newRecoveryCode(passkeysThatSign(), { replace: true });
    expect(sent.map(({ path }) => path)[0]).toBe('/v1/auth/step-up/options');
  });

  it('passes any other failure through without a step-up', async () => {
    answers = [Response.json({ error: { code: 'rate_limited' } }, { status: 429 })];
    await expect(newRecoveryCode(passkeysThatSign(), { replace: false })).rejects.toThrow(ApiError);
    expect(sent).toHaveLength(1);
  });
});

describe('formatting', () => {
  it('groups a code in fours', () => {
    expect(groupCode(recoveryCode)).toBe('0123 4567 89AB CDEF GHJK MNPQ RS');
  });

  it('writes bytes as base64url without padding', () => {
    expect(base64url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-');
    expect(base64url(new Uint8Array(16))).toBe('AAAAAAAAAAAAAAAAAAAAAA');
  });
});

describe('invites (spec 0003, R2)', () => {
  const inviteId = '7b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b';
  const stepUpAnswers = () => [
    Response.json({
      challengeId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
      options: { challenge: 'Y2hhbGxlbmdl', userVerification: 'required' },
    }),
    Response.json({}),
  ];

  it('reads who sent a link, and null for one that opens nothing', async () => {
    answers = [
      Response.json({ inviterEmail: 'owner@example.com' }),
      Response.json({ error: { code: 'not_found' } }, { status: 404 }),
    ];
    expect(await inviteFrom(token)).toEqual({ inviterEmail: 'owner@example.com' });
    expect(await inviteFrom(token)).toBeNull();
    expect(sent.map(({ body }) => body)).toEqual([{ token }, { token }]);
  });

  it.each(['confirm', 'decline'] as const)(
    '%ss after a step-up bound to the invite, sending its nonce',
    async (decision) => {
      answers = [...stepUpAnswers(), Response.json({})];
      await decideInvite(passkeysThatSign(), decision, inviteId);
      expect(sent.map(({ path }) => path)).toEqual([
        '/v1/auth/step-up/options',
        '/v1/auth/step-up/verify',
        `/v1/invites/${decision}`,
      ]);
      const options = sent[0]?.body as { target: { nonce: string } };
      expect(options.target).toEqual({
        action: `${decision}Invite`,
        targets: [inviteId],
        nonce: options.target.nonce,
      });
      expect(sent[2]?.headers.get('arca-step-up-nonce')).toBe(options.target.nonce);
      expect(sent[2]?.body).toEqual({ inviteId });
    },
  );

  it.each([
    [sendFailure, new ApiError(403, 'account_unconfirmed'), 'account_unconfirmed'],
    [sendFailure, new ApiError(409, 'too_many_invites'), 'too_many_invites'],
    [sendFailure, new ApiError(503, 'email_unavailable'), 'email_unavailable'],
    [decisionFailure, new ApiError(404, 'not_found'), 'not_found'],
    [decisionFailure, new ApiError(403, 'step_up_refused'), 'other'],
    [acceptFailure, new ApiError(404, 'not_found'), 'expired'],
    [acceptFailure, new ApiError(403, 'invalid_code'), 'other'],
  ] as const)('words %o', (map, error, failure) => {
    expect(map(error)).toBe(failure);
  });
});

describe('the device list (spec 0003, R4)', () => {
  const targetId = '7b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b';
  const stepUpAnswers = () => [
    Response.json({
      challengeId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
      options: { challenge: 'Y2hhbGxlbmdl', userVerification: 'required' },
    }),
    Response.json({}),
  ];

  it.each([
    [
      'a session',
      () => revokeSession(passkeysThatSign(), targetId),
      'revokeSession',
      [targetId],
      '/v1/devices/sessions/revoke',
      { sessionId: targetId },
    ],
    [
      'a passkey',
      () => revokePasskey(passkeysThatSign(), targetId),
      'revokePasskey',
      [targetId],
      '/v1/devices/passkeys/revoke',
      { passkeyId: targetId },
    ],
    [
      'the other sessions',
      () => revokeOtherSessions(passkeysThatSign()),
      'revokeOtherSessions',
      [],
      '/v1/devices/sessions/revoke-others',
      {},
    ],
  ] as const)(
    'revokes %s after a step-up bound to it',
    async (_, revoke, action, targets, path, body) => {
      answers = [...stepUpAnswers(), Response.json({})];
      await revoke();
      const options = sent[0]?.body as { target: { nonce: string } };
      expect(options.target).toEqual({ action, targets, nonce: options.target.nonce });
      expect(sent[2]?.path).toBe(path);
      expect(sent[2]?.body).toEqual(body);
      expect(sent[2]?.headers.get('arca-step-up-nonce')).toBe(options.target.nonce);
    },
  );

  it('adds a passkey after a step-up, and sends the nonce only with the options', async () => {
    const creation = {
      challenge: 'Y2hhbGxlbmdl',
      rp: { id: 'arca.test', name: 'Arca' },
      user: { id: 'dXNlcg', name: 'owner@example.com', displayName: 'owner@example.com' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      extensions: { prf: {} },
    };
    const attestation: RegistrationResponseJSON = {
      id: 'Y3JlZA',
      rawId: 'Y3JlZA',
      type: 'public-key',
      response: { clientDataJSON: 'e30', attestationObject: 'oA' },
      clientExtensionResults: {},
    };
    const created: unknown[] = [];
    const passkeys: Passkeys = {
      ...passkeysThatSign(),
      create: (options) => {
        created.push(options);
        return Promise.resolve(attestation);
      },
    };
    const challengeId = '8c1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b';
    answers = [
      ...stepUpAnswers(),
      Response.json({ challengeId, options: creation }),
      Response.json({}),
    ];
    await addPasskey(passkeys);
    expect(sent.map(({ path }) => path)).toEqual([
      '/v1/auth/step-up/options',
      '/v1/auth/step-up/verify',
      '/v1/devices/passkeys/options',
      '/v1/devices/passkeys/add',
    ]);
    const options = sent[0]?.body as { target: { nonce: string } };
    expect(options.target).toEqual({
      action: 'addPasskeyOptions',
      targets: [],
      nonce: options.target.nonce,
    });
    expect(sent[2]?.headers.get('arca-step-up-nonce')).toBe(options.target.nonce);
    expect(sent[3]?.headers.has('arca-step-up-nonce')).toBe(false);
    expect(created).toEqual([creation]);
    expect(sent[3]?.body).toEqual({ challengeId, response: attestation });
  });

  it.each([
    [new ApiError(404, 'not_found'), 'not_found'],
    [new ApiError(409, 'last_active_passkey'), 'last_active'],
    [new ApiError(403, 'passkey_refused'), 'refused'],
    [new ApiError(403, 'step_up_refused'), 'other'],
    [new ApiError(429, 'rate_limited'), 'limited'],
  ] as const)('words %o', (error, failure) => {
    expect(deviceFailure(error)).toBe(failure);
  });
});

describe('a change of account', () => {
  it('signs out with an empty body', async () => {
    answers = [Response.json({ success: true })];
    await signOut();
    expect(sent.map(({ path, body }) => ({ path, body }))).toEqual([
      { path: '/v1/auth/sign-out', body: {} },
    ]);
  });

  it("drops every query that is the previous account's own, and only those", async () => {
    const {
      resetAccount,
      devicesQuery,
      healthQuery,
      invitesQuery,
      recoveryKitQuery,
      sessionQuery,
    } = await vi.importActual<typeof import('../src/api.js')>('../src/api.js');
    const queryClient = new QueryClient();
    const keys: QueryKey[] = [
      sessionQuery,
      recoveryKitQuery,
      invitesQuery,
      devicesQuery,
      healthQuery,
    ].map(({ queryKey }) => queryKey);
    for (const key of keys) queryClient.setQueryData(key, { cached: true });
    await resetAccount(queryClient);
    expect(keys.map((key) => queryClient.getQueryData(key))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      { cached: true },
    ]);
  });
});
