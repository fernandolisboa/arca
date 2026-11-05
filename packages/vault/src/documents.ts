import { Decrypter, Encrypter } from 'age-encryption';
import { identityParts, type VaultIdentity } from './identity.js';

const hybridRecipientPrefix = 'age1pq1';

export class InvalidRecipients extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidRecipients';
  }
}

/**
 * Hybrid post-quantum recipients only, so a recipient the server supplies cannot downgrade a
 * document to X25519 alone. The library parses and checks each one when it is added.
 */
export function encrypterFor(recipients: readonly string[]): Encrypter {
  const unique = [...new Set(recipients)];
  if (unique.length === 0) throw new InvalidRecipients('no recipients');
  const encrypter = new Encrypter();
  for (const recipient of unique) {
    if (!recipient.startsWith(hybridRecipientPrefix)) {
      throw new InvalidRecipients('a recipient is not a hybrid post-quantum recipient');
    }
    try {
      encrypter.addRecipient(recipient);
    } catch {
      throw new InvalidRecipients('a recipient is malformed');
    }
  }
  return encrypter;
}

/** One identity, or the current one and those a rotation kept, any of which may open a file. */
export type VaultIdentities = VaultIdentity | readonly VaultIdentity[];

export function decrypterFor(identities: VaultIdentities): Decrypter {
  const decrypter = new Decrypter();
  for (const identity of identities instanceof Uint8Array ? [identities] : identities) {
    decrypter.addIdentity(identityParts(identity).secret);
  }
  return decrypter;
}

/** Encrypts a document as a stream to every recipient, in the plain age format. */
export async function encryptDocument(
  plaintext: ReadableStream<Uint8Array>,
  recipients: readonly string[],
): Promise<ReadableStream<Uint8Array>> {
  return encrypterFor(recipients).encrypt(plaintext);
}

/**
 * Decrypts a document as a stream. The header is checked before this resolves; each chunk is
 * authenticated as it is read, so a stream that errors part way must be discarded.
 */
export async function decryptDocument(
  ciphertext: ReadableStream<Uint8Array>,
  identities: VaultIdentities,
): Promise<ReadableStream<Uint8Array>> {
  return decrypterFor(identities).decrypt(ciphertext);
}

/** Re-encrypts a document to a new recipient set: to share, revoke or rotate. */
export async function reencryptDocument(
  ciphertext: ReadableStream<Uint8Array>,
  identities: VaultIdentities,
  recipients: readonly string[],
): Promise<ReadableStream<Uint8Array>> {
  const encrypter = encrypterFor(recipients);
  return encrypter.encrypt(await decryptDocument(ciphertext, identities));
}
