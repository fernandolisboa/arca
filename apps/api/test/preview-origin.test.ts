import type { Database } from '@arca/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { passkeyCreation } from '../src/auth/passkey-creation.js';
import { readAuthOrigin } from '../src/config.js';
import { softwarePasskey } from './software-passkey.js';

// A preview trusts its branch URL only; its per-deployment URL is another origin (spec 0003, R9).
const branch = 'arca-git-feature-team.vercel.app';
const deployment = 'https://arca-abc123-team.vercel.app';

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('VERCEL_BRANCH_URL', branch);
  vi.stubEnv('VERCEL_URL', new URL(deployment).host);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a preview', () => {
  it('rejects a passkey ceremony run on the deployment URL', async () => {
    const creation = passkeyCreation({ db: {} as Database, origin: readAuthOrigin() });
    const challenge = new Uint8Array(32).fill(5);
    const encoded = Buffer.from(challenge).toString('base64url');
    const passkey = softwarePasskey(branch);
    const elsewhere = passkey.attest({ challenge: encoded, origin: deployment });
    expect(await creation.verify(elsewhere, challenge)).toBeNull();
    const here = passkey.attest({ challenge: encoded, origin: `https://${branch}` });
    expect(await creation.verify(here, challenge)).not.toBeNull();
  });

  it('refuses a state-changing request from the deployment URL', async () => {
    const app = createApp({
      checkDatabase: () => Promise.resolve('ok'),
      logger: { info: () => undefined, error: () => undefined },
      origin: readAuthOrigin(),
    });
    const response = await app.request('/v1/auth/recovery/start', {
      method: 'POST',
      headers: { origin: deployment, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'cross_origin' } });
  });
});
