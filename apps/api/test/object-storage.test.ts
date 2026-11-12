import { createHash, randomBytes } from 'node:crypto';
import {
  maxDocumentBatch,
  maxDocumentBytes,
  maxDocumentLabelBytes,
  maxDocumentRecipients,
  replaceDocumentsAction,
  StepUpAction,
} from '@arca/api-contract/routes';
import {
  maxDocumentBytes as storedDocumentBytes,
  maxDocumentLabelBytes as storedDocumentLabelBytes,
  maxDocumentRecipients as storedDocumentRecipients,
} from '@arca/db/vault-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBlobStore } from '../src/config.js';
import {
  memoryObjectStorage,
  objectUrlMinutes,
  unconnectedObjectStorage,
} from '../src/storage/object-storage.js';
import { objectStorageFor } from '../src/storage/storage-environment.js';

const pathname = 'documents/7d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6';

function grantOf(url: string) {
  return new URL(url, 'http://localhost').searchParams.get('token') ?? '';
}

function uploadGrant(store: ReturnType<typeof memoryObjectStorage>, maxBytes: number) {
  const target = store.uploadTarget(pathname, maxBytes);
  if (target.via !== 'direct') throw new Error('expected a direct upload');
  return grantOf(target.url);
}

describe('the in-memory object store', () => {
  it('stores one upload within its grant, and reports its size and SHA-256', async () => {
    const store = memoryObjectStorage();
    const body = randomBytes(40);
    const token = uploadGrant(store, 40);
    expect(store.receive(pathname, token, randomBytes(41))).toBe(false);
    expect(store.receive(pathname, `${token}x`, body)).toBe(false);
    expect(store.receive(pathname, token, body)).toBe(true);
    expect(store.receive(pathname, token, body)).toBe(false);
    expect(await store.digest(pathname)).toEqual({
      size: 40,
      sha256: createHash('sha256').update(body).digest(),
      head: Buffer.from(body),
    });
  });

  it('never overwrites a stored object, even with a new grant', () => {
    const store = memoryObjectStorage();
    expect(store.receive(pathname, uploadGrant(store, 8), randomBytes(8))).toBe(true);
    expect(store.receive(pathname, uploadGrant(store, 8), randomBytes(8))).toBe(false);
  });

  it(`ends upload and download grants after ${String(objectUrlMinutes)} minutes`, async () => {
    let now = 0;
    const store = memoryObjectStorage('/internal/objects', () => now);
    const late = uploadGrant(store, 8);
    now = objectUrlMinutes * 60_000;
    expect(store.receive(pathname, late, randomBytes(8))).toBe(false);
    expect(store.receive(pathname, uploadGrant(store, 8), randomBytes(8))).toBe(true);
    const download = grantOf(await store.downloadUrl(pathname));
    expect(store.serve(pathname, download)).toBeDefined();
    expect(store.serve(pathname, 'AAAA')).toBeUndefined();
    now += objectUrlMinutes * 60_000;
    expect(store.serve(pathname, download)).toBeUndefined();
  });

  it('deletes objects and their grants, and ignores missing ones', async () => {
    const store = memoryObjectStorage();
    const token = uploadGrant(store, 8);
    await store.delete([pathname, 'documents/missing']);
    expect(store.receive(pathname, token, randomBytes(8))).toBe(false);
    expect(await store.digest(pathname)).toBeUndefined();
  });
});

describe('the unconnected object store', () => {
  it('deletes nothing quietly, and fails when any object would be left behind', async () => {
    await expect(unconnectedObjectStorage.delete([])).resolves.toBeUndefined();
    await expect(unconnectedObjectStorage.delete([pathname])).rejects.toThrow();
  });
});

describe('the store of each environment (spec 0005, R3)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps development in one in-memory store per process', () => {
    const first = objectStorageFor('development');
    expect(first?.memory).toBeDefined();
    expect(objectStorageFor('development')?.memory).toBe(first?.memory);
  });

  it('connects production and previews only to a configured Vercel Blob store', () => {
    expect(objectStorageFor('production', () => undefined)).toBeUndefined();
    const connected = objectStorageFor('preview', () => ({
      storeId: 'store_synthetic',
      webhookPublicKey: 'key',
    }));
    expect(connected?.memory).toBeUndefined();
    expect(connected?.storage.uploadTarget(pathname, 8)).toEqual({ via: 'vercel_blob', pathname });
  });

  it("reads each environment's own store", () => {
    vi.stubEnv('BLOB_STORE_ID', 'store_production');
    vi.stubEnv('BLOB_WEBHOOK_PUBLIC_KEY', 'production-key');
    vi.stubEnv('BLOB_PREVIEW_STORE_ID', ' store_preview ');
    vi.stubEnv('BLOB_PREVIEW_WEBHOOK_PUBLIC_KEY', 'preview-key');
    expect(readBlobStore('production')).toEqual({
      storeId: 'store_production',
      webhookPublicKey: 'production-key',
    });
    expect(readBlobStore('preview')).toEqual({
      storeId: 'store_preview',
      webhookPublicKey: 'preview-key',
    });
    vi.stubEnv('BLOB_PREVIEW_WEBHOOK_PUBLIC_KEY', ' ');
    expect(readBlobStore('preview')).toBeUndefined();
  });
});

describe('the document limits', () => {
  it('are the same in the contract and in the database checks', () => {
    expect(maxDocumentBytes).toBe(storedDocumentBytes);
    expect(maxDocumentRecipients).toBe(storedDocumentRecipients);
    expect(maxDocumentLabelBytes).toBe(storedDocumentLabelBytes);
  });

  it("let the largest replace fit the step-up's caps (spec 0003, R5)", async () => {
    const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const action = await replaceDocumentsAction({
      recipients: Array.from({ length: maxDocumentRecipients }, (_, index) => id(index)),
      documents: Array.from({ length: maxDocumentBatch }, (_, index) => ({
        documentId: id(100 + index),
        size: maxDocumentBytes,
        sha256: 'A'.repeat(43),
        label: 'A'.repeat(43_691),
      })),
    });
    expect(StepUpAction.safeParse({ ...action, nonce: 'MzMzMzMzMzMzMzMzMzMzMw' }).success).toBe(
      true,
    );
  });
});
