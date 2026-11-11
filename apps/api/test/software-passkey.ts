import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { PasskeyAssertion, PasskeyAttestation } from '@arca/api-contract/routes';
import { isoCBOR } from '@simplewebauthn/server/helpers';

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

/** An attestation statement as an authenticator would send it, or one a test forged. */
export interface AttestationStatement {
  readonly fmt: string;
  readonly attStmt: Readonly<Record<string, string | number | Uint8Array | Uint8Array[]>>;
}

const noAttestation: AttestationStatement = { fmt: 'none', attStmt: {} };

function attestationObject({ fmt, attStmt }: AttestationStatement, authData: Buffer): Buffer {
  return Buffer.from(
    isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', fmt],
        ['attStmt', new Map(Object.entries(attStmt))],
        ['authData', new Uint8Array(authData)],
      ]) as Parameters<typeof isoCBOR.encode>[0],
    ),
  );
}

export interface AttestationOptions {
  readonly challenge: string;
  readonly origin: string;
  readonly userVerified?: boolean;
  /**
   * Absent, the "none" format a synced passkey sends; "self" is the packed statement the new key
   * signs itself; anything else is sent as given.
   */
  readonly statement?: 'self' | AttestationStatement;
  /** What the authenticator reports for the PRF extension; absent, it reports nothing. */
  readonly prfEnabled?: boolean;
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
  const rawId = randomBytes(16);
  const credentialId = rawId.toString('base64url');
  const cose = coseKey(Buffer.from(String(x), 'base64url'), Buffer.from(String(y), 'base64url'));
  let counter = 0;
  return {
    credentialId,
    /** Registers the key as a synced passkey would; `statement` changes what attests it. */
    attest({
      challenge,
      origin,
      userVerified = true,
      prfEnabled,
      statement,
    }: AttestationOptions): PasskeyAttestation {
      // UP, UV when verified, backup eligible and backed up, attested credential data.
      const flags = 0x01 | (userVerified ? 0x04 : 0) | 0x08 | 0x10 | 0x40;
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(rawId.length);
      const authenticatorData = Buffer.concat([
        sha256(rpId),
        Buffer.from([flags]),
        Buffer.alloc(4),
        Buffer.alloc(16),
        idLength,
        rawId,
        cose,
      ]);
      const clientDataJSON = Buffer.from(
        JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }),
      );
      const selfAttestation = (): AttestationStatement => ({
        fmt: 'packed',
        attStmt: {
          alg: -7,
          sig: new Uint8Array(
            sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), privateKey),
          ),
        },
      });
      const attestation = attestationObject(
        statement === 'self' ? selfAttestation() : (statement ?? noAttestation),
        authenticatorData,
      );
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: clientDataJSON.toString('base64url'),
          attestationObject: attestation.toString('base64url'),
          transports: ['internal', 'hybrid'],
        },
        authenticatorAttachment: 'platform',
        clientExtensionResults: prfEnabled === undefined ? {} : { prf: { enabled: prfEnabled } },
      };
    },
    /** As the passkey plugin stores it. */
    publicKey: cose.toString('base64'),
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
