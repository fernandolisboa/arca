import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blobObjectStorage } from '../src/vault/blob-storage.js';
import { objectUrlMinutes } from '../src/vault/object-storage.js';

const sdk = vi.hoisted(() => ({
  issued: [] as unknown[],
  presigned: [] as unknown[],
  presignArguments: [] as unknown[],
  read: [] as unknown[],
  deleted: [] as unknown[],
  stored: undefined as { statusCode: number; chunks: Uint8Array[] } | undefined,
}));

vi.mock('@vercel/blob', () => ({
  issueSignedToken: (options: unknown) => {
    sdk.issued.push(options);
    return Promise.resolve({ delegationToken: 'delegation', clientSigningToken: 'signing' });
  },
  presignUrl: (token: unknown, options: unknown) => {
    sdk.presigned.push([token, options]);
    return Promise.resolve({ presignedUrl: 'https://store.example.com/object?signature=s' });
  },
  get: (pathname: string, options: unknown) => {
    sdk.read.push([pathname, options]);
    const stored = sdk.stored;
    return Promise.resolve(
      stored === undefined
        ? null
        : {
            statusCode: stored.statusCode,
            stream: stored.chunks,
          },
    );
  },
  del: (pathnames: string[], options: unknown) => {
    sdk.deleted.push([pathnames, options]);
    return Promise.resolve();
  },
}));

vi.mock('@vercel/blob/client', () => ({
  handleUploadPresigned: async (options: {
    body: { payload: { pathname: string } };
    getSignedToken: (pathname: string) => Promise<{ token: unknown; urlOptions: unknown }>;
  }) => {
    const signed = await options.getSignedToken(options.body.payload.pathname);
    sdk.presignArguments.push([options.body, signed.urlOptions]);
    return {
      type: 'blob.generate-presigned-url',
      presignedUrlPayload: { delegationToken: 'delegation', signature: 'signature', params: {} },
    };
  },
}));

const pathname = 'documents/7d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6';
const storage = blobObjectStorage({ storeId: 'store_synthetic', webhookPublicKey: 'key' });

beforeEach(() => {
  for (const calls of [sdk.issued, sdk.presigned, sdk.presignArguments, sdk.read, sdk.deleted]) {
    calls.length = 0;
  }
  sdk.stored = undefined;
});

const withinGrant = (validUntil: unknown) => {
  const minutes = (Number(validUntil) - Date.now()) / 60_000;
  return minutes > objectUrlMinutes - 0.1 && minutes <= objectUrlMinutes;
};

describe('the Vercel Blob store (spec 0005, R3)', () => {
  it('presigns one put of ciphertext at the pathname, capped at the declared size, never overwriting', async () => {
    const answer = await storage.presignUpload(pathname, 1024, 'application/octet-stream');
    expect(answer.type).toBe('blob.generate-presigned-url');
    const [grant] = sdk.issued as Record<string, unknown>[];
    expect(grant).toMatchObject({
      storeId: 'store_synthetic',
      pathname,
      operations: ['put'],
      maximumSizeInBytes: 1024,
      allowedContentTypes: ['application/octet-stream'],
    });
    expect(withinGrant(grant?.['validUntil'])).toBe(true);
    const [[body, urlOptions]] = sdk.presignArguments as [[unknown, Record<string, unknown>]];
    expect(body).toEqual({
      type: 'blob.generate-presigned-url',
      payload: { pathname, clientPayload: null, multipart: false },
    });
    expect(urlOptions).toMatchObject({ allowOverwrite: false, maximumSizeInBytes: 1024 });
    expect(urlOptions).not.toHaveProperty('callbackUrl');
  });

  it('gives a read-only download URL for 5 minutes, uncached, served as an attachment', async () => {
    expect(await storage.downloadUrl(pathname)).toBe(
      'https://store.example.com/object?signature=s&download=1',
    );
    const [grant] = sdk.issued as Record<string, unknown>[];
    expect(grant).toMatchObject({ storeId: 'store_synthetic', pathname, operations: ['get'] });
    expect(withinGrant(grant?.['validUntil'])).toBe(true);
    expect(sdk.presigned).toEqual([
      [
        { delegationToken: 'delegation', clientSigningToken: 'signing' },
        expect.objectContaining({ operation: 'get', pathname, access: 'private', useCache: false }),
      ],
    ]);
  });

  it('digests the stored object as it streams, and finds nothing where there is none', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    sdk.stored = { statusCode: 200, chunks };
    expect(await storage.digest(pathname)).toEqual({
      size: 5,
      sha256: createHash('sha256')
        .update(new Uint8Array([1, 2, 3, 4, 5]))
        .digest(),
      head: Buffer.from([1, 2, 3, 4, 5]),
    });
    expect(sdk.read).toEqual([
      [pathname, { access: 'private', storeId: 'store_synthetic', useCache: false }],
    ]);
    sdk.stored = undefined;
    expect(await storage.digest(pathname)).toBeUndefined();
    sdk.stored = { statusCode: 304, chunks: [] };
    expect(await storage.digest(pathname)).toBeUndefined();
  });

  it('deletes in one call, and calls nothing for no objects', async () => {
    await storage.delete([]);
    await storage.delete([pathname]);
    expect(sdk.deleted).toEqual([[[pathname], { storeId: 'store_synthetic' }]]);
  });
});
