import type { StepUpPurpose } from '@arca/api-contract/routes';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { stepUpChallenge } from './step-up-encoding.js';

/** A verified step-up as `auth.step_up` stores it, or as a consumer copied it. */
export interface StoredAssertion {
  readonly credentialId: string;
  readonly nonce: Uint8Array;
  readonly authenticatorData: Uint8Array;
  readonly clientDataJson: Uint8Array;
  readonly signature: Uint8Array;
}

/** What the caller expects the assertion to approve, and the key it trusts. */
export interface Expected {
  readonly purpose: StepUpPurpose;
  /** Empty for `vault_unlock`. */
  readonly subjectHash: Uint8Array;
  readonly credentialId: string;
  /** The COSE public key, from wherever the caller trusts: a pinned file, not only the database. */
  readonly publicKey: Uint8Array<ArrayBuffer>;
  readonly rpId: string;
  readonly origin: string;
}

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

/**
 * Verifies a stored step-up again (spec 0003, R5) without reading anything: the challenge is
 * recomputed from the purpose and subject the caller expects, never from the stored row, and the
 * signature is checked against the caller's key. The signature counter is not checked; the first
 * verification did.
 */
export async function reverifyStepUp(
  stored: StoredAssertion,
  expected: Expected,
): Promise<boolean> {
  if (stored.credentialId !== expected.credentialId) return false;
  try {
    const { verified } = await verifyAuthenticationResponse({
      response: {
        id: stored.credentialId,
        rawId: stored.credentialId,
        type: 'public-key',
        response: {
          authenticatorData: base64url(stored.authenticatorData),
          clientDataJSON: base64url(stored.clientDataJson),
          signature: base64url(stored.signature),
        },
        clientExtensionResults: {},
      },
      expectedChallenge: base64url(
        stepUpChallenge(expected.purpose, expected.subjectHash, stored.nonce),
      ),
      expectedOrigin: expected.origin,
      expectedRPID: expected.rpId,
      expectedType: 'webauthn.get',
      // A zero stored counter turns the counter check off: any value passes.
      credential: { id: expected.credentialId, publicKey: expected.publicKey, counter: 0 },
      requireUserVerification: true,
    });
    return verified;
  } catch {
    return false;
  }
}
