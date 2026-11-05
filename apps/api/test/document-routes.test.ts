import { createHash, randomBytes } from 'node:crypto';
import { maxDocumentBytes, type DocumentUploadUrlResponse } from '@arca/api-contract/routes';
import type { Logger } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { SignedIn } from '../src/auth/service.js';
import type { StepUpService } from '../src/auth/step-up.js';
import type { DocumentCreated, DocumentRequests, UploadConfirmed } from '../src/vault/documents.js';
import { memoryObjectStorage, type MemoryObjectStorage } from '../src/vault/object-storage.js';
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
const documentId = '0b4f6a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b';
const pathname = 'documents/7d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6';
const sha256 = createHash('sha256').update('ciphertext').digest('base64url');
const createBody = { typeKey: 'passport', size: 1024, sha256 };
const presigned: DocumentUploadUrlResponse = {
  type: 'blob.generate-presigned-url',
  presignedUrlPayload: { delegationToken: 'token', signature: 'signature', params: {} },
};
const uploadUrlBody = {
  type: 'blob.generate-presigned-url',
  payload: { pathname, clientPayload: null, multipart: false },
};

function setup({
  unlocked = true,
  confirmedAccount = true,
  allowed = true,
  created = { documentId, upload: { via: 'vercel_blob', pathname } },
  presignable = true,
  confirmed = 'confirmed',
  downloadable = true,
  memoryObjects,
}: {
  unlocked?: boolean;
  confirmedAccount?: boolean;
  allowed?: boolean;
  created?: DocumentCreated;
  presignable?: boolean;
  confirmed?: UploadConfirmed;
  downloadable?: boolean;
  memoryObjects?: MemoryObjectStorage;
} = {}) {
  const calls: unknown[] = [];
  const limited: string[] = [];
  const stepUp: StepUpService = {
    options: () => Promise.reject(new Error('unused')),
    verify: () => Promise.reject(new Error('unused')),
    consume: () => Promise.reject(new Error('unused')),
    vaultUnlocked: () => Promise.resolve(unlocked),
  };
  const documents: DocumentRequests = {
    create: (accountId, request) => {
      calls.push(['create', accountId, request]);
      return Promise.resolve(created);
    },
    presignUpload: (accountId, path) => {
      calls.push(['presignUpload', accountId, path]);
      return Promise.resolve(presignable ? presigned : undefined);
    },
    confirm: (accountId, id) => {
      calls.push(['confirm', accountId, id]);
      return Promise.resolve(confirmed);
    },
    list: (accountId, after) => {
      calls.push(['list', accountId, after]);
      return Promise.resolve({ documents: [], next: null });
    },
    downloadUrl: (accountId, id) => {
      calls.push(['downloadUrl', accountId, id]);
      return Promise.resolve(downloadable ? 'https://objects.example.com/one' : undefined);
    },
  };
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
    documents,
    accountConfirmed: () => Promise.resolve(confirmedAccount),
    ...(memoryObjects === undefined ? {} : { memoryObjects }),
  });
  const request = (
    method: string,
    path: string,
    { headers = {}, body }: { headers?: Record<string, string>; body?: string | Uint8Array } = {},
  ) =>
    app.request(path, {
      method,
      headers: { origin, cookie: 'session=1', ...headers },
      ...(body === undefined ? {} : { body }),
    });
  const call = (method: 'GET' | 'POST', path: string, body?: unknown) =>
    request(method, `/v1${path}`, {
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { call, request, calls, limited };
}

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('creating a document (spec 0005, R4)', () => {
  it('adds a pending document for a confirmed account, counted by its own limit', async () => {
    const { call, calls, limited } = setup();
    const response = await call('POST', '/vault/documents', createBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ documentId, upload: { via: 'vercel_blob', pathname } });
    expect(calls).toEqual([['create', owner.accountId, createBody]]);
    expect(limited).toEqual(['document_create_account']);
  });

  it.each([
    [{ confirmedAccount: false }, 403, 'account_unconfirmed'],
    [{ unlocked: false }, 403, 'step_up_required'],
    [{ allowed: false }, 429, 'rate_limited'],
    [{ created: 'no_vault' as const }, 404, 'not_found'],
    [{ created: 'over_quota' as const }, 409, 'document_quota'],
  ])('answers %o with %i', async (options, status, code) => {
    const response = await setup(options).call('POST', '/vault/documents', createBody);
    expect(response.status).toBe(status);
    expect(await errorOf(response)).toBe(code);
  });

  it.each([
    ['an empty document', { ...createBody, size: 0 }],
    ['a document over 25 MB', { ...createBody, size: maxDocumentBytes + 1 }],
    ['a short SHA-256', { ...createBody, sha256: sha256.slice(1) }],
    ['a type key with spaces', { ...createBody, typeKey: 'birth certificate' }],
    ['an extra field', { ...createBody, name: 'passport.pdf' }],
  ])('refuses %s', async (_, body) => {
    const { call, calls } = setup();
    expect((await call('POST', '/vault/documents', body)).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('presigning an upload (spec 0005, R4)', () => {
  it('presigns the pathname the client names, if the account has it pending', async () => {
    const { call, calls } = setup();
    const response = await call('POST', '/vault/documents/upload-url', uploadUrlBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(presigned);
    expect(calls).toEqual([['presignUpload', owner.accountId, pathname]]);
    const missing = await setup({ presignable: false }).call(
      'POST',
      '/vault/documents/upload-url',
      uploadUrlBody,
    );
    expect(missing.status).toBe(404);
  });

  it.each([
    ['a multipart upload', { ...uploadUrlBody.payload, multipart: true }],
    ['a long client payload', { ...uploadUrlBody.payload, clientPayload: 'x'.repeat(257) }],
    ['a long pathname', { ...uploadUrlBody.payload, pathname: `documents/${'a'.repeat(200)}` }],
  ])('refuses %s', async (_, payload) => {
    const { call, calls } = setup();
    const response = await call('POST', '/vault/documents/upload-url', {
      ...uploadUrlBody,
      payload,
    });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('confirming an upload (spec 0005, R4)', () => {
  it.each([
    ['confirmed' as const, 200, undefined],
    ['not_found' as const, 404, 'not_found'],
    ['not_uploaded' as const, 409, 'not_uploaded'],
    ['mismatch' as const, 409, 'upload_mismatch'],
  ])('answers %s with %i', async (confirmed, status, code) => {
    const { call, calls, limited } = setup({ confirmed });
    const response = await call('POST', '/vault/documents/confirm', { documentId });
    expect(response.status).toBe(status);
    if (code !== undefined) expect(await errorOf(response)).toBe(code);
    expect(calls).toEqual([['confirm', owner.accountId, documentId]]);
    expect(limited).toEqual(['document_confirm_account']);
  });
});

describe('listing and downloading documents (spec 0005, R4)', () => {
  it('lists from the cursor', async () => {
    const { call, calls } = setup();
    const response = await call('GET', `/vault/documents?after=${documentId}`);
    expect(response.status).toBe(200);
    expect(calls).toEqual([['list', owner.accountId, documentId]]);
  });

  it('gives a download URL inside a vault_unlock window only, never cached', async () => {
    const { call, calls } = setup();
    const response = await call('POST', '/vault/documents/download', { documentId });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { url, expiresAt } = (await response.json()) as { url: string; expiresAt: string };
    expect(url).toBe('https://objects.example.com/one');
    const minutes = (Date.parse(expiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(4.9);
    expect(minutes).toBeLessThanOrEqual(5);
    expect(calls).toEqual([['downloadUrl', owner.accountId, documentId]]);

    const locked = setup({ unlocked: false });
    const refused = await locked.call('POST', '/vault/documents/download', { documentId });
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe('step_up_required');
    expect(locked.calls).toEqual([]);
    const missing = await setup({ downloadable: false }).call('POST', '/vault/documents/download', {
      documentId,
    });
    expect(missing.status).toBe(404);
  });
});

describe('the in-memory store (spec 0005, R3; development only)', () => {
  it('takes an upload with its grant and serves it with a download grant', async () => {
    const memoryObjects = memoryObjectStorage();
    const { request } = setup({ memoryObjects });
    const body = randomBytes(32);
    const upload = memoryObjects.uploadTarget(pathname, body.length);
    if (upload.via !== 'direct') throw new Error('expected a direct upload');
    expect((await request('PUT', upload.url, { body: `${body.toString('hex')}x` })).status).toBe(
      404,
    );
    expect((await request('PUT', upload.url, { body })).status).toBe(204);
    expect((await request('PUT', upload.url, { body })).status).toBe(404);

    const download = await memoryObjects.downloadUrl(pathname);
    const served = await request('GET', download);
    expect(served.status).toBe(200);
    expect(served.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await served.arrayBuffer())).toEqual(body);
    expect((await request('GET', download.replace(/token=.*/, 'token=AAAA'))).status).toBe(404);
  });
});
