import { ApiError, createApiClient } from '@arca/api-contract/client';
import type { Passkeys } from '@arca/platform';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearFragment,
  groupCode,
  linkRequestFailure,
  linkTokenFrom,
  newRecoveryCode,
  registrationFailure,
} from '../src/enrollment.js';
import { UnreachableError } from '../src/requests.js';
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
