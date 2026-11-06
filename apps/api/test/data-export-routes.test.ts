import { DataExport } from '@arca/api-contract/routes';
import { describe, expect, it } from 'vitest';
import type { DataExports } from '../src/account/data-export.js';
import { createApp } from '../src/app.js';
import type { SignedIn } from '../src/auth/service.js';
import type { CanonicalAction } from '../src/auth/step-up-encoding.js';
import type { StepUpService } from '../src/auth/step-up.js';
import type { Logger } from '@arca/telemetry';
import { noLimits } from './limits.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const owner: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const nonce = 'MzMzMzMzMzMzMzMzMzMzMw';
const document: DataExport = {
  schemaVersion: 2,
  exportedAt: '2026-11-04T13:20:00.123456+00:00',
  tables: [
    {
      table: 'auth.user',
      label: 'Conta',
      rows: [{ email: 'owner@example.com', created_at: '2026-11-01T10:00:00+00:00' }],
    },
  ],
  case: null,
};

function setup({
  signedIn = owner,
  approved = [true],
  withNonce = true,
}: { signedIn?: SignedIn | null; approved?: boolean[]; withNonce?: boolean } = {}) {
  const built: string[] = [];
  const spent: { purpose: string; action: CanonicalAction }[] = [];
  const answers = [...approved];
  const stepUp: StepUpService = {
    options: () => Promise.reject(new Error('unused')),
    verify: () => Promise.reject(new Error('unused')),
    consume: (_, purpose, action) => {
      spent.push({ purpose, action });
      return Promise.resolve(answers.shift() ?? false);
    },
    vaultUnlocked: () => Promise.resolve(false),
  };
  const dataExports: DataExports = {
    build: (accountId) => {
      built.push(accountId);
      return Promise.resolve(document);
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
    stepUp,
    dataExports,
  });
  const exportData = () =>
    app.request('/v1/account/export', {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        ...(withNonce ? { 'arca-step-up-nonce': nonce } : {}),
      },
      body: '{}',
    });
  return { exportData, built, spent };
}

describe('POST /v1/account/export (spec 0004, R8)', () => {
  it('answers the export as a download that is never cached, after a data_export step-up', async () => {
    const { exportData, built, spent } = setup();
    const response = await exportData();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="arca-export-2026-11-04.json"',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(DataExport.parse(await response.json())).toEqual(document);
    expect(built).toEqual([owner.accountId]);
    expect(spent).toEqual([
      {
        purpose: 'data_export',
        action: {
          action: 'exportAccountData',
          targets: [],
          nonce: new Uint8Array(Buffer.from(nonce, 'base64url')),
        },
      },
    ]);
  });

  it('answers 403 without a fresh step-up, and builds nothing', async () => {
    const { exportData, built } = setup({ approved: [false] });
    const response = await exportData();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'step_up_required' } });
    expect(built).toEqual([]);
  });

  it('answers 403 without the nonce header, and spends nothing', async () => {
    const { exportData, built, spent } = setup({ withNonce: false });
    expect((await exportData()).status).toBe(403);
    expect(spent).toEqual([]);
    expect(built).toEqual([]);
  });

  it('needs a second step-up for a second export', async () => {
    const { exportData, built } = setup({ approved: [true] });
    expect((await exportData()).status).toBe(200);
    expect((await exportData()).status).toBe(403);
    expect(built).toHaveLength(1);
  });

  it('answers 401 without a session', async () => {
    const { exportData, spent } = setup({ signedIn: null });
    expect((await exportData()).status).toBe(401);
    expect(spent).toEqual([]);
  });
});
