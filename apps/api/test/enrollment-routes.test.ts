import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Enrollment, EnrollOwnerOutcome } from '../src/auth/enrollment.js';
import type { CreateInviteOutcome, Invites } from '../src/auth/invites.js';
import type { RateLimitRule } from '../src/auth/rate-limit.js';
import type { RecoveryKits } from '../src/auth/recovery-kit.js';
import type { Registration, RegistrationOutcome } from '../src/auth/registration.js';
import type { SignedIn } from '../src/auth/service.js';
import type { CanonicalAction } from '../src/auth/step-up-encoding.js';
import type { StepUpService } from '../src/auth/step-up.js';
import type { Logger } from '../src/logger.js';
import { attestation, creationOptions } from './passkey-fixtures.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const owner: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const token = 'A'.repeat(43);
const nonce = 'MzMzMzMzMzMzMzMzMzMzMw';

interface Setup {
  readonly signedIn?: SignedIn | null;
  readonly allowed?: boolean;
  readonly enrolled?: EnrollOwnerOutcome;
  readonly registered?: Extract<RegistrationOutcome<never>, { ok: false }>['reason'] | 'ok';
  readonly firstKit?: string | null;
  readonly approved?: boolean;
  readonly kitExists?: boolean;
  readonly invited?: CreateInviteOutcome;
  readonly decided?: boolean;
}

function setup({
  signedIn = owner,
  allowed = true,
  enrolled = 'sent',
  registered = 'ok',
  firstKit = null,
  approved = true,
  kitExists = true,
  invited = 'sent',
  decided = true,
}: Setup = {}) {
  const calls: string[] = [];
  const hits: string[] = [];
  const consumed: { purpose: string; action: CanonicalAction }[] = [];
  const outcome = <Body>(body: Body): RegistrationOutcome<Body> =>
    registered === 'ok'
      ? { ok: true, body, setCookies: ['__Host-arca.session_token=s; Path=/; Secure'] }
      : { ok: false, reason: registered };
  const enrollment: Enrollment = {
    enrollOwner: (request) => {
      calls.push(`enroll ${request.email}`);
      return Promise.resolve(enrolled);
    },
  };
  const registration: Registration = {
    options: (_, request) => {
      calls.push(`options ${request.code ?? '-'}`);
      return Promise.resolve(outcome(creationOptions as never));
    },
    verify: (_, request) => {
      calls.push(`verify ${request.code ?? '-'}`);
      return Promise.resolve(outcome({}));
    },
  };
  const recoveryKits: RecoveryKits = {
    status: () => Promise.resolve('unsaved'),
    issueFirst: () => {
      calls.push('issueFirst');
      return Promise.resolve(firstKit);
    },
    regenerate: () => {
      calls.push('regenerate');
      return Promise.resolve('1'.repeat(26));
    },
    confirm: () => Promise.resolve(kitExists),
  };
  const stepUp: StepUpService = {
    options: () => Promise.reject(new Error('unused')),
    verify: () => Promise.reject(new Error('unused')),
    consume: (_, purpose, action) => {
      consumed.push({ purpose, action });
      return Promise.resolve(approved);
    },
    vaultUnlocked: () => Promise.resolve(false),
  };
  const invites: Invites = {
    create: (inviterId, email) => {
      calls.push(`invite ${inviterId} ${email}`);
      return Promise.resolve(invited);
    },
    list: () => Promise.resolve([]),
    details: () => Promise.resolve({ inviterEmail: 'owner@example.com' }),
    confirm: (_, inviteId) => {
      calls.push(`confirm ${inviteId}`);
      return Promise.resolve(decided);
    },
    decline: (_, inviteId) => {
      calls.push(`decline ${inviteId}`);
      return Promise.resolve(decided);
    },
    accepted: () => Promise.resolve(),
  };
  const app = createApp({
    accountsOpen: true,
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(signedIn),
      refresh: () => Promise.resolve({ session: null, setCookies: [] }),
    },
    authLimits: {
      limiter: {
        hit: (rule: RateLimitRule, subject) => {
          hits.push(`${rule.name} ${subject}`);
          return Promise.resolve(allowed ? { allowed } : { allowed, retryAfterSeconds: 60 });
        },
      },
      clientAddress: () => '198.51.100.7',
    },
    stepUp,
    enrollment,
    registration,
    recoveryKits,
    invites,
  });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(`/v1${path}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return { app, post, calls, hits, consumed };
}

describe('owner enrollment (spec 0003, R2)', () => {
  const body = { code: 'synthetic-code', email: 'owner@example.com' };

  it('answers 200 once the link is sent, counted per address', async () => {
    const { post, calls, hits } = setup();
    const response = await post('/auth/enroll-owner', body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(calls).toEqual(['enroll owner@example.com']);
    expect(hits).toEqual(['enroll_owner_ip 198.51.100.7']);
  });

  it.each([
    ['not_found', 404],
    ['email_unavailable', 503],
  ] as const)('answers %s with %i', async (enrolled, status) => {
    const response = await setup({ enrolled }).post('/auth/enroll-owner', body);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code: enrolled } });
  });

  it('answers 429 over the limit before reading the code', async () => {
    const { post, calls } = setup({ allowed: false });
    expect((await post('/auth/enroll-owner', body)).status).toBe(429);
    expect(calls).toEqual([]);
  });
});

describe('registration from a link (spec 0003, R2 and R3)', () => {
  it('answers 409 signed_in to options while a session exists, before any ceremony', async () => {
    const { post, calls } = setup();
    const response = await post('/auth/registration/options', { token, code: 'c' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: 'signed_in' } });
    expect(calls).toEqual([]);
  });

  it('passes the options and the challenge cookie through', async () => {
    const { post, hits } = setup({ signedIn: null });
    const response = await post('/auth/registration/options', { token, code: 'c' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(creationOptions);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(hits).toEqual(['registration_options_ip 198.51.100.7']);
  });

  it('signs in on a verified registration and answers with nothing else', async () => {
    const { post, calls } = setup({ signedIn: null });
    const response = await post('/auth/registration/verify', {
      token,
      code: 'c',
      response: attestation,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(response.headers.getSetCookie()[0]).toMatch(/^__Host-arca\.session_token=/);
    expect(calls).toEqual(['verify c']);
  });

  it.each([
    ['not_found', 404, 'not_found'],
    ['invalid_code', 403, 'invalid_code'],
    ['refused', 403, 'registration_refused'],
  ] as const)('answers %s with %i', async (registered, status, code) => {
    const response = await setup({ registered, signedIn: null }).post(
      '/auth/registration/options',
      { token },
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it.each([
    ['a token in another shape', { token: 'short' }],
    ['a PRF output among the extension results', null],
  ])('answers 400 to %s', async (_, request) => {
    const { post, calls } = setup({ signedIn: null });
    const body = request ?? {
      token,
      response: {
        ...attestation,
        clientExtensionResults: { prf: { enabled: true, results: { first: 'AA' } } },
      },
    };
    const path = request === null ? '/auth/registration/verify' : '/auth/registration/options';
    expect((await post(path, body)).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('the recovery kit routes (spec 0003, R6)', () => {
  it('answers 401 without a session', async () => {
    const { app, post, calls } = setup({ signedIn: null });
    expect((await app.request('/v1/account/recovery-kit')).status).toBe(401);
    expect((await post('/account/recovery-kit', {})).status).toBe(401);
    expect((await post('/account/recovery-kit/confirm', {})).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('issues the first kit with no step-up', async () => {
    const { post, calls, consumed } = setup({ firstKit: '0'.repeat(26) });
    const response = await post('/account/recovery-kit', {});
    expect(await response.json()).toEqual({ code: '0'.repeat(26) });
    expect(calls).toEqual(['issueFirst']);
    expect(consumed).toEqual([]);
  });

  it('replaces a kit only with a sensitive_settings step-up for this action and nonce', async () => {
    const { post, calls, consumed } = setup();
    const response = await post('/account/recovery-kit', {}, { 'arca-step-up-nonce': nonce });
    expect(response.status).toBe(200);
    expect(calls).toEqual(['issueFirst', 'regenerate']);
    expect(consumed).toEqual([
      {
        purpose: 'sensitive_settings',
        action: {
          action: 'regenerateRecoveryKit',
          targets: [],
          nonce: new Uint8Array(Buffer.from(nonce, 'base64url')),
        },
      },
    ]);
  });

  it.each([
    ['no nonce', {}, true],
    ['a malformed nonce', { 'arca-step-up-nonce': 'not-a-nonce' }, true],
    ['no step-up to spend', { 'arca-step-up-nonce': nonce }, false],
  ])('answers 403 step_up_required with %s', async (_, headers, approved) => {
    const { post, calls } = setup({ approved });
    const response = await post('/account/recovery-kit', {}, headers);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'step_up_required' } });
    expect(calls).toEqual(['issueFirst']);
  });

  it('confirms a kit, and answers 404 when there is none', async () => {
    expect((await setup().post('/account/recovery-kit/confirm', {})).status).toBe(200);
    const missing = await setup({ kitExists: false }).post('/account/recovery-kit/confirm', {});
    expect(missing.status).toBe(404);
  });
});

describe('the invite routes (spec 0003, R2)', () => {
  const inviteId = '7b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b';

  it('answers 401 without a session', async () => {
    const { app, post, calls } = setup({ signedIn: null });
    expect((await post('/invites', { email: 'invitee@example.org' })).status).toBe(401);
    expect((await app.request('/v1/invites')).status).toBe(401);
    expect((await post('/invites/confirm', { inviteId })).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('sends an invite from the session account, counted per account', async () => {
    const { post, calls, hits } = setup();
    const response = await post('/invites', { email: 'invitee@example.org' });
    expect(response.status).toBe(200);
    expect(calls).toEqual([`invite ${owner.accountId} invitee@example.org`]);
    expect(hits).toEqual([`invite_create_account ${owner.accountId}`]);
  });

  it.each([
    ['unconfirmed', 403, 'account_unconfirmed'],
    ['too_many', 409, 'too_many_invites'],
    ['email_unavailable', 503, 'email_unavailable'],
  ] as const)('answers %s with %i', async (invited, status, code) => {
    const response = await setup({ invited }).post('/invites', { email: 'invitee@example.org' });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
  });

  it('shows who sent a link, counted per address, with no session needed', async () => {
    const { post, hits } = setup({ signedIn: null });
    const response = await post('/invites/details', { token });
    expect(await response.json()).toEqual({ inviterEmail: 'owner@example.com' });
    expect(hits).toEqual(['invite_details_ip 198.51.100.7']);
  });

  it.each(['confirm', 'decline'] as const)(
    '%ss only with a sensitive_settings step-up bound to that invite',
    async (decision) => {
      const { post, calls, consumed } = setup();
      const response = await post(
        `/invites/${decision}`,
        { inviteId },
        { 'arca-step-up-nonce': nonce },
      );
      expect(response.status).toBe(200);
      expect(calls).toEqual([`${decision} ${inviteId}`]);
      expect(consumed).toEqual([
        {
          purpose: 'sensitive_settings',
          action: {
            action: `${decision}Invite`,
            targets: [inviteId],
            nonce: new Uint8Array(Buffer.from(nonce, 'base64url')),
          },
        },
      ]);
    },
  );

  it('answers 403 step_up_required without a step-up, and 404 to an invite with no decision due', async () => {
    const refused = await setup({ approved: false }).post(
      '/invites/confirm',
      { inviteId },
      { 'arca-step-up-nonce': nonce },
    );
    expect(await refused.json()).toEqual({ error: { code: 'step_up_required' } });
    const missing = await setup({ decided: false }).post(
      '/invites/decline',
      { inviteId },
      { 'arca-step-up-nonce': nonce },
    );
    expect(missing.status).toBe(404);
  });
});
