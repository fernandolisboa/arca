import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DocumentUpload, DocumentUploadUrlResponse } from '@arca/api-contract/routes';

/** What the store holds under a pathname: its size, SHA-256 and first bytes. */
export interface StoredObject {
  readonly size: number;
  readonly sha256: Buffer;
  /** At most the first `objectHeadBytes`, for a check of the type by content. */
  readonly head: Buffer;
}

export const objectHeadBytes = 1024;

/** The media type of document ciphertext, the only type a vault upload may have. */
export const ciphertextType = 'application/octet-stream';

/** Whether the server may read an object: a correction file, never document ciphertext. */
export const readablePathname = (pathname: string) => pathname.startsWith('corrections/');

/** A stream's bytes, or undefined once they run past `maxBytes`. */
export async function bytesWithin(
  chunks: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  const read: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of chunks) {
    size += chunk.length;
    if (size > maxBytes) return undefined;
    read.push(chunk);
  }
  return Buffer.concat(read);
}

/** The SHA-256 and first bytes of a stream of chunks, as `digest` answers. */
export async function digestOf(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<StoredObject> {
  const hash = createHash('sha256');
  const head: Buffer[] = [];
  let size = 0;
  for await (const chunk of chunks) {
    if (size < objectHeadBytes) head.push(Buffer.from(chunk.subarray(0, objectHeadBytes - size)));
    size += chunk.length;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest(), head: Buffer.concat(head) };
}

/** Where the app serves the in-memory store's upload and download URLs, in development only. */
export const memoryObjectsPath = '/internal/objects';

/** How long an upload grant or a download URL stays usable (spec 0005, R3). */
export const objectUrlMinutes = 5;

/**
 * Where document ciphertext (spec 0005, R3 and R4) and correction request files (ADR-0029) live.
 * Their routes, the daily jobs and `eraseAccount` use this port, never the store's SDK directly.
 */
export interface ObjectStorage {
  /** How the device uploads at most `maxBytes` to this pathname. */
  readonly uploadTarget: (pathname: string, maxBytes: number) => DocumentUpload;
  /**
   * The presigned upload for one pathname, at most `maxBytes` long and of `contentType` only,
   * valid for 5 minutes.
   */
  readonly presignUpload: (
    pathname: string,
    maxBytes: number,
    contentType: string,
  ) => Promise<DocumentUploadUrlResponse>;
  /** The object's size, SHA-256 and first bytes, or undefined when nothing is stored there. */
  readonly digest: (pathname: string) => Promise<StoredObject | undefined>;
  /**
   * The object's bytes, or undefined when nothing is stored there or it runs past `maxBytes`. Only
   * correction files are read on the server, which stores document ciphertext without reading it;
   * any other pathname is refused.
   */
  readonly read: (pathname: string, maxBytes: number) => Promise<Uint8Array | undefined>;
  /** A URL that reads the object for 5 minutes, served as an attachment with `nosniff`. */
  readonly downloadUrl: (pathname: string) => Promise<string>;
  /** Deletes the objects; a missing one is not an error. */
  readonly delete: (pathnames: readonly string[]) => Promise<void>;
}

/**
 * Where no store is connected, no document could be created; the jobs still erase through this,
 * so a document that somehow exists fails its erasure instead of leaving its object behind.
 */
export const unconnectedObjectStorage: ObjectStorage = {
  uploadTarget: () => {
    throw new Error('no object store is connected');
  },
  presignUpload: () => Promise.reject(new Error('no object store is connected')),
  digest: () => Promise.reject(new Error('no object store is connected')),
  read: () => Promise.reject(new Error('no object store is connected')),
  downloadUrl: () => Promise.reject(new Error('no object store is connected')),
  delete: (pathnames) =>
    pathnames.length === 0
      ? Promise.resolve()
      : Promise.reject(new Error('documents remain but no object store is connected')),
};

interface Grant {
  readonly token: Buffer;
  readonly maxBytes: number;
  readonly until: number;
}

/**
 * A store in this process's memory, for development and tests: it serves its own upload and
 * download URLs under `basePath`. Production refuses it (see `objectStorageFor`).
 */
export interface MemoryObjectStorage extends ObjectStorage {
  /** Stores an upload, if the grant for the pathname allows it; false otherwise. */
  readonly receive: (pathname: string, token: string, body: Uint8Array) => boolean;
  /** The bytes a download URL reads, if its grant still holds. */
  readonly serve: (pathname: string, token: string) => Uint8Array | undefined;
}

export function memoryObjectStorage(
  basePath: string = memoryObjectsPath,
  clock: () => number = Date.now,
): MemoryObjectStorage {
  const objects = new Map<string, Uint8Array>();
  const uploads = new Map<string, Grant>();
  const downloads = new Map<string, Grant>();
  const grant = (grants: Map<string, Grant>, pathname: string, maxBytes: number) => {
    const token = randomBytes(32);
    grants.set(pathname, { token, maxBytes, until: clock() + objectUrlMinutes * 60_000 });
    return `${basePath}/${pathname}?token=${token.toString('base64url')}`;
  };
  const held = (grants: Map<string, Grant>, pathname: string, token: string) => {
    const found = grants.get(pathname);
    const given = Buffer.from(token, 'base64url');
    return found !== undefined &&
      found.until > clock() &&
      given.length === found.token.length &&
      timingSafeEqual(given, found.token)
      ? found
      : undefined;
  };
  return {
    uploadTarget: (pathname, maxBytes) => ({
      via: 'direct',
      url: grant(uploads, pathname, maxBytes),
    }),
    presignUpload: () => Promise.reject(new Error('the memory store takes direct uploads only')),
    digest: (pathname) => {
      const bytes = objects.get(pathname);
      return bytes === undefined ? Promise.resolve(undefined) : digestOf([bytes]);
    },
    read: (pathname, maxBytes) => {
      if (!readablePathname(pathname)) return Promise.reject(new Error('not a correction file'));
      const bytes = objects.get(pathname);
      return Promise.resolve(bytes === undefined || bytes.length > maxBytes ? undefined : bytes);
    },
    downloadUrl: (pathname) => Promise.resolve(grant(downloads, pathname, 0)),
    delete: (pathnames) => {
      for (const pathname of pathnames) {
        objects.delete(pathname);
        uploads.delete(pathname);
        downloads.delete(pathname);
      }
      return Promise.resolve();
    },
    receive: (pathname, token, body) => {
      const upload = held(uploads, pathname, token);
      if (upload === undefined || body.length > upload.maxBytes || objects.has(pathname)) {
        return false;
      }
      uploads.delete(pathname);
      objects.set(pathname, body);
      return true;
    },
    serve: (pathname, token) =>
      held(downloads, pathname, token) === undefined ? undefined : objects.get(pathname),
  };
}
