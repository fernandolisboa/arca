import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { PasskeyAssertion } from '@arca/api-contract/routes';

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest();

/** A COSE EC2 P-256 ES256 key in CBOR: {1: 2, 3: -7, -1: 1, -2: x, -3: y}. */
function coseKey(x: Buffer, y: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    Buffer.from([0x22, 0x58, 0x20]),
    y,
  ]);
}

export interface AssertionOptions {
  readonly challenge: string;
  readonly origin: string;
  /** False leaves the UV flag unset, as an authenticator that skipped verification would. */
  readonly userVerified?: boolean;
}

/**
 * A test-only authenticator: a P-256 key pair that signs WebAuthn assertions the way a platform
 * authenticator does, so tests run the real verification instead of forging a session.
 */
export function softwarePasskey(rpId: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const { x, y } = publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(16).toString('base64url');
  let counter = 0;
  return {
    credentialId,
    /** As the passkey plugin stores it. */
    publicKey: coseKey(
      Buffer.from(String(x), 'base64url'),
      Buffer.from(String(y), 'base64url'),
    ).toString('base64'),
    assert({ challenge, origin, userVerified = true }: AssertionOptions): PasskeyAssertion {
      counter += 1;
      const flags = 0x01 | (userVerified ? 0x04 : 0);
      const signCount = Buffer.alloc(4);
      signCount.writeUInt32BE(counter);
      const authenticatorData = Buffer.concat([sha256(rpId), Buffer.from([flags]), signCount]);
      const clientDataJSON = Buffer.from(
        JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }),
      );
      const signature = sign(
        'sha256',
        Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
        privateKey,
      );
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: clientDataJSON.toString('base64url'),
          authenticatorData: authenticatorData.toString('base64url'),
          signature: signature.toString('base64url'),
        },
        authenticatorAttachment: 'platform',
        clientExtensionResults: {},
      };
    },
  };
}

export type SoftwarePasskey = ReturnType<typeof softwarePasskey>;
