import { readBlobStore, type DeploymentEnvironment } from '../config.js';
import { blobObjectStorage, type BlobStore } from './blob-storage.js';
import {
  memoryObjectStorage,
  type MemoryObjectStorage,
  type ObjectStorage,
} from './object-storage.js';

export interface EnvironmentStorage {
  readonly storage: ObjectStorage;
  /** Set in development, where the app itself serves the store's URLs. */
  readonly memory?: MemoryObjectStorage;
}

let developmentStore: MemoryObjectStorage | undefined;

/**
 * Production and previews each reach their own private Vercel Blob store (spec 0005, R3);
 * development keeps objects in one in-memory store per process, which the server and the jobs
 * share. Undefined where the store is not connected: the document
 * routes are then absent.
 */
export function objectStorageFor(
  environment: DeploymentEnvironment,
  store: (environment: 'production' | 'preview') => BlobStore | undefined = readBlobStore,
): EnvironmentStorage | undefined {
  if (environment === 'development') {
    const memory = (developmentStore ??= memoryObjectStorage());
    return { storage: memory, memory };
  }
  const connected = store(environment);
  return connected === undefined ? undefined : { storage: blobObjectStorage(connected) };
}
