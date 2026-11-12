import { type CorrectionFileType, routes } from '@arca/api-contract/client';
import { api } from '../api.js';
import { base64url } from '../base64url.js';
import { saveFile } from '../download.js';
import { reach } from '../requests.js';
import { sendUpload } from '../uploads.js';

/** Uploads one file for a request about to be filed; answers the upload the request names. */
export async function uploadCorrectionFile(
  file: File,
  mediaType: CorrectionFileType,
): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  const { uploadId, upload } = await reach(
    api.call(routes.startCorrectionUpload, { mediaType, size: bytes.length, sha256 }),
  );
  await sendUpload(upload, bytes, {
    handleUploadPath: routes.correctionUploadUrl.path,
    contentType: mediaType,
  });
  return uploadId;
}

/** Downloads one file of a request and saves it on this device under `fileName`. */
export async function saveCorrectionFile(requestId: string, position: number, fileName: string) {
  const { url } = await reach(api.call(routes.correctionFileUrl, { requestId, position }));
  const response = await reach(fetch(url, { cache: 'no-store' }));
  if (!response.ok) throw new Error('the file was not downloaded');
  saveFile(fileName, await response.blob());
}
