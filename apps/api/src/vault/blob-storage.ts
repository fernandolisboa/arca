import { del, get, issueSignedToken, presignUrl } from '@vercel/blob';
import { handleUploadPresigned } from '@vercel/blob/client';
import { DocumentUploadUrlResponse } from '@arca/api-contract/routes';
import { digestOf, objectUrlMinutes, type ObjectStorage } from './object-storage.js';

/** The environment's private Vercel Blob store, reached with Vercel's OIDC token (spec 0005, R3). */
export interface BlobStore {
  readonly storeId: string;
  /** Required by the SDK's presigned-upload helper; no upload callback is ever registered. */
  readonly webhookPublicKey: string;
}

const expiry = () => Date.now() + objectUrlMinutes * 60_000;

export function blobObjectStorage({ storeId, webhookPublicKey }: BlobStore): ObjectStorage {
  return {
    uploadTarget: (pathname) => ({ via: 'vercel_blob', pathname }),

    async presignUpload(pathname, maxBytes, contentType) {
      const validUntil = expiry();
      const limits = {
        validUntil,
        maximumSizeInBytes: maxBytes,
        allowedContentTypes: [contentType],
      };
      const answer = await handleUploadPresigned({
        body: {
          type: 'blob.generate-presigned-url',
          payload: { pathname, clientPayload: null, multipart: false },
        },
        // Read only for an upload callback, which is never set: confirmation is a route of ours.
        request: new Request('https://upload.invalid/'),
        webhookPublicKey,
        getSignedToken: async () => ({
          token: await issueSignedToken({ storeId, pathname, operations: ['put'], ...limits }),
          urlOptions: { ...limits, allowOverwrite: false },
        }),
      });
      return DocumentUploadUrlResponse.parse(answer);
    },

    async digest(pathname) {
      const found = await get(pathname, { access: 'private', storeId, useCache: false });
      if (found?.statusCode !== 200) return undefined;
      return digestOf(found.stream);
    },

    async downloadUrl(pathname) {
      const validUntil = expiry();
      const token = await issueSignedToken({ storeId, pathname, operations: ['get'], validUntil });
      const { presignedUrl } = await presignUrl(token, {
        operation: 'get',
        pathname,
        access: 'private',
        validUntil,
        useCache: false,
      });
      // The store sends `nosniff` on every blob; `download` makes it an attachment too, and sits
      // outside the signed parameters, as the SDK's own `cache` does.
      const url = new URL(presignedUrl);
      url.searchParams.set('download', '1');
      return url.toString();
    },

    async delete(pathnames) {
      if (pathnames.length > 0) await del([...pathnames], { storeId });
    },
  };
}
