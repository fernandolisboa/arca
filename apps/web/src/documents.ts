import {
  ApiError,
  apiBasePath,
  deleteDocumentsAction,
  maxDocumentBytes,
  routes,
  type DocumentUpload,
  type VaultDocument,
} from '@arca/api-contract/client';
import type { Passkeys } from '@arca/platform';
import {
  decryptDocument,
  documentName,
  encryptDocument,
  openDocumentLabel,
  sealDocumentLabel,
  type DocumentLabel,
} from '@arca/vault';
import { queryOptions } from '@tanstack/react-query';
import { api } from './api.js';
import { base64url, fromBase64url } from './base64url.js';
import { saveFile } from './download.js';
import { reach } from './requests.js';
import { openVaultWindow, stepUpFor } from './step-up.js';
import type { UnlockedVault } from './vault-session.js';

/** Until the document catalog arrives with the consultancy core, every document is this type. */
const uncataloguedType = 'other';

/** The file is over the 25 MB a document may take once encrypted. */
export class DocumentTooLarge extends Error {
  override name = 'DocumentTooLarge';
}

/** The stored ciphertext or its label is not what the list said: nothing of it is shown. */
export class DocumentNotOpened extends Error {
  override name = 'DocumentNotOpened';
}

export interface OpenedDocument {
  readonly document: VaultDocument;
  /** Undefined when the label does not open, so the screen names the document itself. */
  readonly label: DocumentLabel | undefined;
}

const bytesOf = async (stream: ReadableStream<Uint8Array>) =>
  new Uint8Array(await new Response(stream).arrayBuffer());

const sha256Of = async (bytes: Uint8Array<ArrayBuffer>) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

async function openLabel(vault: UnlockedVault, document: VaultDocument) {
  try {
    return await openDocumentLabel(
      fromBase64url(document.label),
      vault.identity,
      fromBase64url(document.sha256),
    );
  } catch {
    return undefined;
  }
}

/**
 * Every document the account owns or receives, with its label opened on this device; the names
 * stay in memory only while the vault is open.
 */
export function documentsQuery(vault: UnlockedVault) {
  return queryOptions({
    queryKey: ['documents', vault.accountId, vault.recipient],
    queryFn: async (): Promise<OpenedDocument[]> => {
      const documents: VaultDocument[] = [];
      let after: string | undefined;
      do {
        const page = await reach(
          api.call(routes.listDocuments, after === undefined ? {} : { after }),
        );
        documents.push(...page.documents);
        after = page.next ?? undefined;
      } while (after !== undefined);
      return Promise.all(
        documents.map(async (document) => ({ document, label: await openLabel(vault, document) })),
      );
    },
    gcTime: 0,
    networkMode: 'always',
    retry: false,
  });
}

/**
 * Runs a request that needs this session's `vault_unlock` window; when the window has ended while
 * the vault stayed open here, opens it again with the passkey and tries once more.
 */
async function inVaultWindow<T>(passkeys: Passkeys, request: () => Promise<T>): Promise<T> {
  try {
    return await reach(request());
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'step_up_required')) throw error;
    await openVaultWindow(passkeys);
    return reach(request());
  }
}

async function send(upload: DocumentUpload, ciphertext: Uint8Array<ArrayBuffer>) {
  if (upload.via === 'direct') {
    const response = await reach(fetch(upload.url, { method: 'PUT', body: ciphertext }));
    if (!response.ok) throw new Error('the upload was refused');
    return;
  }
  // The Blob client loads only when a document goes to Vercel Blob, never in development.
  const { uploadPresigned } = await import('@vercel/blob/client');
  await uploadPresigned(upload.pathname, new Blob([ciphertext]), {
    access: 'private',
    handleUploadUrl: `${apiBasePath}${routes.documentUploadUrl.path}`,
    contentType: 'application/octet-stream',
    multipart: false,
  });
}

/**
 * Encrypts a file on this device to the owner's own recipient, seals its name and type the same
 * way, then creates the document, uploads the ciphertext and confirms it (spec 0005, R4).
 */
export async function addDocument(
  passkeys: Passkeys,
  vault: UnlockedVault,
  file: File,
  fallbackName: string,
) {
  if (file.size > maxDocumentBytes) throw new DocumentTooLarge();
  const recipients = [vault.recipient];
  const ciphertext = await bytesOf(await encryptDocument(file.stream(), recipients));
  if (ciphertext.length > maxDocumentBytes) throw new DocumentTooLarge();
  const sha256 = await sha256Of(ciphertext);
  const name = documentName(file.name);
  const label = await sealDocumentLabel(
    { name: name === '' ? fallbackName : name, type: file.type },
    sha256,
    recipients,
  );
  const { documentId, upload } = await inVaultWindow(passkeys, () =>
    api.call(routes.createDocument, {
      typeKey: uncataloguedType,
      size: ciphertext.length,
      sha256: base64url(sha256),
      label: base64url(label),
    }),
  );
  await send(upload, ciphertext);
  await reach(api.call(routes.confirmDocumentUpload, { documentId }));
}

/**
 * Downloads the ciphertext, checks it is the one the list named, decrypts it on this device and
 * saves the file under its own name.
 */
export async function saveDocument(
  passkeys: Passkeys,
  vault: UnlockedVault,
  { document, label }: OpenedDocument,
) {
  if (label === undefined) throw new DocumentNotOpened();
  const { url } = await inVaultWindow(passkeys, () =>
    api.call(routes.documentDownloadUrl, { documentId: document.id }),
  );
  const response = await reach(fetch(url, { cache: 'no-store' }));
  if (!response.ok) throw new DocumentNotOpened();
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  if (!sameBytes(await sha256Of(ciphertext), fromBase64url(document.sha256))) {
    throw new DocumentNotOpened();
  }
  let plaintext: Uint8Array<ArrayBuffer>;
  try {
    plaintext = await bytesOf(
      await decryptDocument(new Blob([ciphertext]).stream(), vault.identity),
    );
  } catch {
    throw new DocumentNotOpened();
  }
  saveFile(label.name, new Blob([plaintext], { type: label.type }));
}

/** Deletes one of the account's documents after a `vault_write` step-up for exactly it. */
export async function deleteDocument(passkeys: Passkeys, documentId: string) {
  const request = { documentIds: [documentId] };
  const client = await stepUpFor(passkeys, deleteDocumentsAction(request), 'vault_write');
  await reach(client.call(routes.deleteDocuments, request));
}
