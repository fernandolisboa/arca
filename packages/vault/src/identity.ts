import { bech32 } from '@scure/base';
import { generateHybridIdentity, identityToRecipient } from 'age-encryption';
import { lengthPrefixed, splitLengthPrefixed, utf8 } from './encoding.js';

declare const vaultIdentityBrand: unique symbol;

/**
 * A person's unlocked vault identity with its share key (ADR-0018), as the bytes an envelope
 * seals. Opaque outside this package: a port that seals it stores these bytes unchanged, and
 * every function here checks them before use.
 */
export type VaultIdentity = Uint8Array & { readonly [vaultIdentityBrand]: true };

const formatTag = 'arca-vault-identity/v1';
const shareKeyBytes = 32;
const hybridIdentityPrefix = 'age-secret-key-pq-';
const hybridSeedBytes = 32;

export interface IdentityParts {
  /** The age hybrid identity, `AGE-SECRET-KEY-PQ-1…`. */
  readonly secret: string;
  /** The 256-bit key that authenticates the person's sharing state. */
  readonly shareKey: Uint8Array<ArrayBuffer>;
}

export class InvalidVaultIdentity extends Error {
  constructor() {
    super('not a vault identity');
    this.name = 'InvalidVaultIdentity';
  }
}

/** A new hybrid ML-KEM-768 + X25519 identity and a new share key, generated on the device. */
export async function generateVaultIdentity(): Promise<VaultIdentity> {
  const shareKey = crypto.getRandomValues(new Uint8Array(shareKeyBytes));
  return identityFrom({ secret: await generateHybridIdentity(), shareKey });
}

/** The public recipient (`age1pq1…`) documents are encrypted to. */
export async function recipientOf(identity: VaultIdentity): Promise<string> {
  return identityToRecipient(identityParts(identity).secret);
}

/** A short form of a recipient for two people to compare: 128 bits of its SHA-256, in groups. */
export async function recipientFingerprint(recipient: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(recipient)));
  const hex = [...digest.subarray(0, 16)].map((byte) => byte.toString(16).padStart(2, '0'));
  return Array.from({ length: 8 }, (_, group) => hex.slice(group * 2, group * 2 + 2).join('')).join(
    ' ',
  );
}

export function identityFrom(parts: IdentityParts): VaultIdentity {
  return lengthPrefixed([
    utf8.encode(formatTag),
    utf8.encode(parts.secret),
    parts.shareKey,
  ]) as VaultIdentity;
}

/** The identity's parts, after checking the format, the identity type and the key length. */
export function identityParts(identity: Uint8Array): IdentityParts {
  const parts = splitLengthPrefixed(identity, 3);
  if (parts === undefined) throw new InvalidVaultIdentity();
  const [tag, secret, shareKey] = parts as [
    Uint8Array<ArrayBuffer>,
    Uint8Array<ArrayBuffer>,
    Uint8Array<ArrayBuffer>,
  ];
  let text: string;
  try {
    if (utf8.decode(tag) !== formatTag) throw new InvalidVaultIdentity();
    text = utf8.decode(secret);
  } catch {
    throw new InvalidVaultIdentity();
  }
  if (!isHybridIdentity(text) || shareKey.length !== shareKeyBytes) {
    throw new InvalidVaultIdentity();
  }
  return { secret: text, shareKey };
}

function isHybridIdentity(text: string): boolean {
  if (text !== text.toUpperCase()) return false;
  try {
    const { prefix, bytes } = bech32.decodeToBytes(text.toLowerCase());
    return prefix === hybridIdentityPrefix && bytes.length === hybridSeedBytes;
  } catch {
    return false;
  }
}
