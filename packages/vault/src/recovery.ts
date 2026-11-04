import { base32crockford } from '@scure/base';
import { Decrypter, Encrypter } from 'age-encryption';
import { identityParts, type VaultIdentity } from './identity.js';

const secretBytes = 16;

export class WrongRecoverySecret extends Error {
  constructor() {
    super('the recovery secret does not open this envelope');
    this.name = 'WrongRecoverySecret';
  }
}

/** The vault recovery secret: 128 random bits in Crockford base32, 26 symbols (ADR-0018). */
export function generateRecoverySecret(): string {
  return base32crockford.encode(crypto.getRandomValues(new Uint8Array(secretBytes)));
}

/**
 * The canonical form of a secret as a person types it back: case, spaces and hyphens do not
 * matter, and the letters Crockford base32 reads as digits (I, L, O) count as those digits.
 */
export function normalizeRecoverySecret(typed: string): string | undefined {
  const symbols = typed.replace(/[\s-]/g, '').toUpperCase();
  try {
    const bytes = base32crockford.decode(symbols);
    return bytes.length === secretBytes ? base32crockford.encode(bytes) : undefined;
  } catch {
    return undefined;
  }
}

/** Seals the identity in an age file encrypted with the recovery secret as its scrypt passphrase. */
export async function sealRecoveryEnvelope(
  identity: VaultIdentity,
  recoverySecret: string,
): Promise<Uint8Array> {
  identityParts(identity);
  const encrypter = new Encrypter();
  encrypter.setPassphrase(canonicalSecret(recoverySecret));
  return encrypter.encrypt(identity);
}

export async function openRecoveryEnvelope(
  envelope: Uint8Array,
  recoverySecret: string,
): Promise<VaultIdentity> {
  const decrypter = new Decrypter();
  decrypter.addPassphrase(canonicalSecret(recoverySecret));
  let opened: Uint8Array;
  try {
    opened = await decrypter.decrypt(envelope);
  } catch {
    throw new WrongRecoverySecret();
  }
  identityParts(opened);
  return opened as VaultIdentity;
}

function canonicalSecret(secret: string): string {
  const canonical = normalizeRecoverySecret(secret);
  if (canonical === undefined) throw new WrongRecoverySecret();
  return canonical;
}
