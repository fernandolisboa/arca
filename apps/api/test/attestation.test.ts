import type { Database } from '@arca/db';
import { verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attestsWithoutCertificates } from '../src/auth/attestation.js';
import { passkeyCreation } from '../src/auth/passkey-creation.js';
import {
  appleAttestation,
  certificateAttestations,
  revocationListUrl,
} from './certificate-attestations.js';
import { softwarePasskey, type AttestationOptions } from './software-passkey.js';

const origin = 'https://arca.example';
const challenge = new Uint8Array(32).fill(7);
const attest = (statement?: AttestationOptions['statement']) =>
  softwarePasskey('arca.example').attest({
    challenge: Buffer.from(challenge).toString('base64url'),
    origin,
    ...(statement === undefined ? {} : { statement }),
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('an attestation object', () => {
  it.each([
    ['no attestation', undefined],
    ['a self attestation', 'self' as const],
  ])('goes to the verifier when it is %s', (_name, statement) => {
    expect(attestsWithoutCertificates(attest(statement).response.attestationObject)).toBe(true);
  });

  it.each(certificateAttestations.map((statement) => [statement.fmt, statement] as const))(
    'is refused when it is a %s statement with certificates',
    (_fmt, statement) => {
      expect(attestsWithoutCertificates(attest(statement).response.attestationObject)).toBe(false);
    },
  );

  it.each([
    ['an unknown format', attest({ fmt: 'unknown', attStmt: {} }).response.attestationObject],
    [
      '"none" with a certificate',
      attest({ fmt: 'none', attStmt: appleAttestation.attStmt }).response.attestationObject,
    ],
    [
      'packed with an empty certificate list',
      attest({ fmt: 'packed', attStmt: { alg: -7, x5c: [] } }).response.attestationObject,
    ],
    ['not CBOR', Buffer.from('not an attestation object').toString('base64url')],
    ['a CBOR value that is no map', Buffer.from([0x80]).toString('base64url')],
    ['a map with no statement', Buffer.from([0xa0]).toString('base64url')],
    ['empty', ''],
  ])('is refused when it is %s', (_name, attestationObject) => {
    expect(attestsWithoutCertificates(attestationObject)).toBe(false);
  });
});

describe('adding a passkey', () => {
  const creation = passkeyCreation({ db: {} as Database, origin });
  const stubFetch = () => {
    const fetched = vi.fn(() => Promise.reject(new Error('no request may leave')));
    vi.stubGlobal('fetch', fetched);
    return fetched;
  };

  // The premise of the two tests after it: if an upgrade stops this request, they prove nothing.
  it('would request the revocation list a certificate names, were it not refused', async () => {
    const fetched = stubFetch();
    await expect(
      verifyRegistrationResponse({
        response: attest(appleAttestation) as RegistrationResponseJSON,
        expectedChallenge: Buffer.from(challenge).toString('base64url'),
        expectedOrigin: origin,
        expectedRPID: 'arca.example',
      }),
    ).rejects.toThrow();
    expect(fetched).toHaveBeenCalledExactlyOnceWith(revocationListUrl);
  });

  it.each(certificateAttestations.map((statement) => [statement.fmt, statement] as const))(
    'refuses a %s statement with certificates and requests nothing',
    async (_fmt, statement) => {
      const fetched = stubFetch();
      expect(await creation.verify(attest(statement), challenge)).toBeNull();
      expect(fetched).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['no attestation', undefined],
    ['a self attestation', 'self' as const],
  ])('accepts %s and requests nothing', async (_name, statement) => {
    const fetched = stubFetch();
    expect(await creation.verify(attest(statement), challenge)).not.toBeNull();
    expect(fetched).not.toHaveBeenCalled();
  });
});
