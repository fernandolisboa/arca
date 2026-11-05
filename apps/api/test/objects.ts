import type { MemoryObjectStorage } from '../src/vault/object-storage.js';

/** Stores `body` at `pathname` the way a device does: through a direct upload grant. */
export function putObject(store: MemoryObjectStorage, pathname: string, body: Uint8Array): void {
  const target = store.uploadTarget(pathname, body.length);
  if (target.via !== 'direct') throw new Error('the memory store takes direct uploads only');
  const token = new URL(target.url, 'http://localhost').searchParams.get('token') ?? '';
  if (!store.receive(pathname, token, body)) throw new Error('the upload was refused');
}
