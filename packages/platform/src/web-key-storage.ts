import { requireCapability, type Capabilities } from './capabilities.js';
import { lengthPrefixed } from './framing.js';
import type { KeyContext, KeyStorage } from './key-storage.js';

export const keyStorageDatabase = 'arca-key-storage';
const storeName = 'secrets';
const slot = 'vault';
const formatVersion = 1;
const ivBytes = 12;

/** What IndexedDB holds: a key the page cannot export, and the secret wrapped under it. */
interface WrappedSecret {
  readonly version: number;
  readonly key: CryptoKey;
  readonly iv: Uint8Array<ArrayBuffer>;
  readonly ciphertext: ArrayBuffer;
}

function additionalData(context: KeyContext): Uint8Array<ArrayBuffer> {
  return lengthPrefixed([
    `arca-key-storage/v${String(formatVersion)}`,
    context.accountId,
    context.relyingPartyId,
  ]);
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    });
  });
}

async function withStore<T>(
  indexedDB: IDBFactory,
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const opening = indexedDB.open(keyStorageDatabase, 1);
  opening.addEventListener('upgradeneeded', () => {
    opening.result.createObjectStore(storeName);
  });
  const database = await settled(opening);
  try {
    return await settled(use(database.transaction(storeName, mode).objectStore(storeName)));
  } finally {
    database.close();
  }
}

function isWrappedSecret(value: unknown): value is WrappedSecret {
  const record = value as Partial<WrappedSecret> | undefined;
  return (
    record?.version === formatVersion &&
    record.key instanceof CryptoKey &&
    record.iv instanceof Uint8Array &&
    record.iv.length === ivBytes &&
    record.ciphertext instanceof ArrayBuffer
  );
}

/**
 * Non-extractable AES-GCM-256 keys in IndexedDB (spec 0005, R5). Anything that fails to open,
 * including an evicted database or a blob from another account, origin or relying party, reads
 * as "not stored".
 */
export function createWebKeyStorage(
  capabilities: Capabilities,
  scope: typeof globalThis = globalThis,
): KeyStorage {
  const { crypto, indexedDB } = scope;
  return {
    async store(context, secret) {
      requireCapability(capabilities, 'keyStorage');
      try {
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        const iv = crypto.getRandomValues(new Uint8Array(ivBytes));
        const ciphertext = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv, additionalData: additionalData(context) },
          key,
          new Uint8Array(secret),
        );
        const record: WrappedSecret = { version: formatVersion, key, iv, ciphertext };
        await withStore(indexedDB, 'readwrite', (store) => store.put(record, slot));
        return 'stored';
      } catch {
        return 'not stored';
      }
    },
    async load(context) {
      requireCapability(capabilities, 'keyStorage');
      try {
        const record: unknown = await withStore(indexedDB, 'readonly', (store) => store.get(slot));
        if (!isWrappedSecret(record)) return { status: 'not stored' };
        const secret = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: record.iv, additionalData: additionalData(context) },
          record.key,
          record.ciphertext,
        );
        return { status: 'stored', secret: new Uint8Array(secret) };
      } catch {
        return { status: 'not stored' };
      }
    },
    async forget() {
      requireCapability(capabilities, 'keyStorage');
      await settled(indexedDB.deleteDatabase(keyStorageDatabase));
    },
  };
}
