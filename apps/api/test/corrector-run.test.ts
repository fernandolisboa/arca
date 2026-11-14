import type { Logger } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { SignedIn } from '../src/auth/service.js';
import { correctorTaskId, routineCorrectorRun } from '../src/knowledge/corrector-run.js';
import type { CorrectorKeys } from '../src/knowledge/corrector.js';
import { noLimits } from './limits.js';

/** Synthetic routes only. */
const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const owner: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};

describe('routineCorrectorRun (ADR-0029)', () => {
  const token = 'synthetic_routine_token_aaaaaaaaaaaa';

  it("fires the owner's task with its token and a fixed note, and nothing else", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const run = routineCorrectorRun({
      token,
      logger: silentLogger,
      fetch: (url, init) => {
        calls.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
        return Promise.resolve(Response.json({ type: 'routine_fire' }));
      },
    });
    expect(await run.start()).toBe(true);
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
    expect(url).toBe(`https://api.anthropic.com/v1/claude_code/routines/${correctorTaskId}/fire`);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers).toMatchObject({
      authorization: `Bearer ${token}`,
      'anthropic-beta': 'experimental-cc-routine-2026-04-01',
      'anthropic-version': '2023-06-01',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'Started from the app by an owner-list admin.',
    });
  });

  it('answers false when claude.ai refuses or cannot be reached', async () => {
    const refused = routineCorrectorRun({
      token,
      logger: silentLogger,
      fetch: () => Promise.resolve(new Response('no', { status: 401 })),
    });
    expect(await refused.start()).toBe(false);
    const down = routineCorrectorRun({
      token,
      logger: silentLogger,
      fetch: () => Promise.reject(new Error('down')),
    });
    expect(await down.start()).toBe(false);
  });
});

function setup({
  status = 'owner',
  configured = true,
  accepted = true,
  blocked,
  signedIn = owner,
}: {
  status?: 'owner' | 'granted' | 'not_admin';
  configured?: boolean;
  accepted?: boolean;
  blocked?: string;
  signedIn?: SignedIn | null;
} = {}) {
  let fired = 0;
  const limited: [string, string][] = [];
  const correctorKeys = {
    status: () =>
      Promise.resolve(
        status === 'not_admin' ? status : { canManage: status === 'owner', key: null },
      ),
  } as unknown as CorrectorKeys;
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(signedIn),
      refresh: () => Promise.resolve({ session: null, setCookies: [] }),
    },
    authLimits: {
      ...noLimits,
      limiter: {
        hit: (rule, subject) => {
          limited.push([rule.name, subject]);
          return Promise.resolve(
            rule.name === blocked ? { allowed: false, retryAfterSeconds: 60 } : { allowed: true },
          );
        },
      },
    },
    correctorKeys,
    ...(configured
      ? {
          correctorRun: {
            start: () => {
              fired += 1;
              return Promise.resolve(accepted);
            },
          },
        }
      : {}),
  });
  const start = (headers: Record<string, string> = { origin }) =>
    app.request('/v1/knowledge/corrector/run', { method: 'POST', headers });
  return { start, limited, fired: () => fired };
}

describe('POST /v1/knowledge/corrector/run (ADR-0029)', () => {
  it("starts the owner's run for an owner-list admin, within 4 an hour per account", async () => {
    const { start, limited, fired } = setup();
    const response = await start();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(fired()).toBe(1);
    expect(limited).toEqual([['corrector_run_account', owner.accountId]]);
  });

  it('starts nothing past the limit', async () => {
    const { start, fired } = setup({ blocked: 'corrector_run_account' });
    expect((await start()).status).toBe(429);
    expect(fired()).toBe(0);
  });

  it('refuses anyone off the owner list, a granted admin included, and anyone signed out', async () => {
    const notAdmin = setup({ status: 'not_admin' });
    const refused = await notAdmin.start();
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: { code: 'not_admin' } });
    expect(notAdmin.fired()).toBe(0);
    const granted = setup({ status: 'granted' });
    expect((await granted.start()).status).toBe(403);
    expect(granted.fired()).toBe(0);
    const signedOut = setup({ signedIn: null });
    expect((await signedOut.start()).status).toBe(401);
    expect(signedOut.fired()).toBe(0);
  });

  it('refuses another origin', async () => {
    const { start, fired } = setup();
    expect((await start({ origin: 'https://evil.example' })).status).toBe(403);
    expect(fired()).toBe(0);
  });

  it('answers 503 where no token is configured, and 502 when claude.ai did not accept it', async () => {
    const off = await setup({ configured: false }).start();
    expect(off.status).toBe(503);
    expect(await off.json()).toEqual({ error: { code: 'corrector_off' } });
    const failed = await setup({ accepted: false }).start();
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: { code: 'corrector_not_started' } });
  });
});
