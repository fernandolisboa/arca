import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { DeploymentEnvironment } from '../config.js';

/** The stored format; the database refuses any other. */
export const aiKeyFormatVersion = 1;

const nonceLength = 12;
const tagLength = 16;

/** What a stored key row keeps besides its identity. */
export interface SealedAiKey {
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly tag: Buffer;
  readonly kekVersion: number;
  readonly formatVersion: number;
}

/** What the associated data binds: a key sealed for one row, provider and environment opens there only. */
export interface AiKeyBinding {
  readonly environment: DeploymentEnvironment;
  readonly keyId: string;
  readonly provider: string;
}

const uint32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};

/** Each part prefixed with its length, so no two bindings share an encoding. */
function associatedData(binding: AiKeyBinding, formatVersion: number, kekVersion: number): Buffer {
  const parts = [
    'arca-ai-key',
    String(formatVersion),
    String(kekVersion),
    binding.environment,
    binding.keyId,
    binding.provider,
  ].map((part) => Buffer.from(part, 'utf8'));
  return Buffer.concat(parts.flatMap((part) => [uint32(part.length), part]));
}

/**
 * AES-256-GCM over a provider's API key (ADR-0031), from `node:crypto` only: a random 96-bit nonce
 * per seal, a 128-bit tag on both sides, and associated data binding the format, the
 * key-encryption key's version, the environment, the row and the provider. The version is derived
 * from the key-encryption key itself, so a rotated one is told apart without opening anything.
 * Opening anything else, a tampered row or another key-encryption key fails closed with
 * `undefined`.
 */
export function aiKeyCipher(kek: Buffer) {
  if (kek.length !== 32) throw new Error('The key-encryption key must be 32 bytes');
  const kekVersion =
    createHash('sha256').update('arca-ai-kek-version').update(kek).digest().readUInt32BE(0) >>> 1 ||
    1;
  return {
    kekVersion,

    seal(key: string, binding: AiKeyBinding): SealedAiKey {
      const nonce = randomBytes(nonceLength);
      const cipher = createCipheriv('aes-256-gcm', kek, nonce, { authTagLength: tagLength });
      cipher.setAAD(associatedData(binding, aiKeyFormatVersion, kekVersion));
      const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
      return {
        ciphertext,
        nonce,
        tag: cipher.getAuthTag(),
        kekVersion,
        formatVersion: aiKeyFormatVersion,
      };
    },

    open(sealed: SealedAiKey, binding: AiKeyBinding): string | undefined {
      if (
        sealed.formatVersion !== aiKeyFormatVersion ||
        sealed.kekVersion !== kekVersion ||
        sealed.nonce.length !== nonceLength ||
        sealed.tag.length !== tagLength
      ) {
        return undefined;
      }
      try {
        const decipher = createDecipheriv('aes-256-gcm', kek, sealed.nonce, {
          authTagLength: tagLength,
        });
        decipher.setAAD(associatedData(binding, sealed.formatVersion, sealed.kekVersion));
        decipher.setAuthTag(sealed.tag);
        return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString(
          'utf8',
        );
      } catch {
        return undefined;
      }
    },
  };
}

export type AiKeyCipher = ReturnType<typeof aiKeyCipher>;
