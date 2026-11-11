import type { AttestationStatement } from './software-passkey.js';

/**
 * A synthetic self-signed certificate, made for these tests, whose only purpose is to name a
 * revocation list at http://crl.invalid/arca-test.crl; its private key was thrown away.
 */
const certificate = Buffer.from(
  'MIIB4DCCAYagAwIBAgIUMBeqE1AmwCu7DmMDKLU4jCKzU8swCgYIKoZIzj0EAwIwKjEoMCYGA1UEAwwfQXJjYSBzeW50' +
    'aGV0aWMgYXR0ZXN0YXRpb24gdGVzdDAgFw0yNjExMTEwODU1MDFaGA8yMTI2MTAxODA4NTUwMVowKjEoMCYGA1UEAwwf' +
    'QXJjYSBzeW50aGV0aWMgYXR0ZXN0YXRpb24gdGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABLcFqoFk9uFSof7q' +
    'HLX7yumAVjUFSIw35k75wLz9nZbV6Nn12uaybatj7yx0O5regmPMiiJTh7Dx9nG9cQr9SR+jgYcwgYQwHQYDVR0OBBYE' +
    'FAWss/igC+yDg/ZdHEc76i6pmsJ/MB8GA1UdIwQYMBaAFAWss/igC+yDg/ZdHEc76i6pmsJ/MA8GA1UdEwEB/wQFMAMB' +
    'Af8wMQYDVR0fBCowKDAmoCSgIoYgaHR0cDovL2NybC5pbnZhbGlkL2FyY2EtdGVzdC5jcmwwCgYIKoZIzj0EAwIDSAAw' +
    'RQIgKL0gSyWJCwHA/dqEFrswxWgVLTlOv0WiNmWlOECmZKACIQC6AgnoFq2yLfUpb+yG2UUm7UXU4mq7f6HiOEEDp5m/' +
    'yw==',
  'base64',
);

const x5c = [new Uint8Array(certificate)];
const sig = new Uint8Array(64);
const jws = (header: object) =>
  new TextEncoder().encode(
    [header, {}].map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.') +
      '.AA',
  );

/** The statement that makes an unguarded verifier request the revocation list. */
export const appleAttestation: AttestationStatement = { fmt: 'apple', attStmt: { x5c } };
export const revocationListUrl = 'http://crl.invalid/arca-test.crl';

/**
 * One statement per format that carries certificates, each with the certificate above. Only the
 * Apple one is forged well enough to reach the request in SimpleWebAuthn 13.3.3; the verifier
 * turns the others away on earlier checks, so they pin the refusal of their format.
 */
export const certificateAttestations: readonly AttestationStatement[] = [
  { fmt: 'packed', attStmt: { alg: -7, sig, x5c } },
  appleAttestation,
  { fmt: 'android-key', attStmt: { alg: -7, sig, x5c } },
  {
    fmt: 'android-safetynet',
    attStmt: { ver: '1', response: jws({ alg: 'ES256', x5c: [certificate.toString('base64')] }) },
  },
  { fmt: 'fido-u2f', attStmt: { sig, x5c } },
  {
    fmt: 'tpm',
    attStmt: {
      ver: '2.0',
      alg: -7,
      sig,
      x5c,
      certInfo: new Uint8Array(1),
      pubArea: new Uint8Array(1),
    },
  },
];
