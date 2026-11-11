import { decodeAttestationObject, isoBase64URL } from '@simplewebauthn/server/helpers';

/**
 * Whether a registration's attestation object may go to the WebAuthn verifier: only "none" and a
 * packed self attestation, the two a browser sends when asked for no attestation. For a statement
 * with certificates SimpleWebAuthn requests the revocation list a certificate names, an address
 * the caller would choose. Read with the verifier's own decoder, so both see the same statement.
 */
export function attestsWithoutCertificates(attestationObject: string): boolean {
  try {
    const decoded = decodeAttestationObject(isoBase64URL.toBuffer(attestationObject));
    const fmt = decoded.get('fmt');
    return (fmt === 'none' || fmt === 'packed') && decoded.get('attStmt').get('x5c') === undefined;
  } catch {
    return false;
  }
}
