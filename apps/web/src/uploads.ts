import { apiBasePath, type ObjectUpload } from '@arca/api-contract/client';
import { reach } from './requests.js';

/**
 * Sends bytes to the pathname the server granted: straight to the in-memory store in development,
 * or to Vercel Blob through `uploadPresigned`, which asks `handleUploadPath` for the signed URL.
 */
export async function sendUpload(
  upload: ObjectUpload,
  bytes: Uint8Array<ArrayBuffer>,
  {
    handleUploadPath,
    contentType,
  }: { readonly handleUploadPath: string; readonly contentType: string },
) {
  if (upload.via === 'direct') {
    const response = await reach(fetch(upload.url, { method: 'PUT', body: bytes }));
    if (!response.ok) throw new Error('the upload was refused');
    return;
  }
  // The Blob client loads only when a file goes to Vercel Blob, never in development.
  const { uploadPresigned } = await import('@vercel/blob/client');
  await uploadPresigned(upload.pathname, new Blob([bytes], { type: contentType }), {
    access: 'private',
    handleUploadUrl: `${apiBasePath}${handleUploadPath}`,
    contentType,
    multipart: false,
  });
}
