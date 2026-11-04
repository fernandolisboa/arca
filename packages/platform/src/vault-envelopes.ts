import type { VaultIdentity } from '@arca/vault';

/** A vault identity sealed to one passkey (ADR-0018). The bytes are a plain age file. */
export interface VaultEnvelope {
  readonly credentialId: string;
  readonly bytes: Uint8Array;
}

/**
 * Why a passkey ceremony gave no envelope or identity: the person cancelled or the browser
 * refused (`cancelled`, worth a retry), the passkey or browser has no PRF (`prf_unavailable`, the
 * recovery kit instead), or the envelope did not open with this passkey (`not_opened`).
 */
export type EnvelopeFailure = 'cancelled' | 'prf_unavailable' | 'not_opened';

export class EnvelopeNotOpenedError extends Error {
  override name = 'EnvelopeNotOpenedError';
  readonly reason: EnvelopeFailure;
  constructor(reason: EnvelopeFailure, options?: ErrorOptions) {
    super(`the envelope did not open: ${reason}`, options);
    this.reason = reason;
  }
}

export class EnvelopeNotSealedError extends Error {
  override name = 'EnvelopeNotSealedError';
  readonly reason: Exclude<EnvelopeFailure, 'not_opened'>;
  constructor(reason: Exclude<EnvelopeFailure, 'not_opened'>, options?: ErrorOptions) {
    super(`the envelope was not sealed: ${reason}`, options);
    this.reason = reason;
  }
}

/**
 * Seals and opens vault identities with a passkey's PRF output, which never leaves this port
 * (spec 0005, R5). The only producer of passkey envelopes.
 */
export interface VaultEnvelopes {
  seal(identity: VaultIdentity, credentialId: string): Promise<VaultEnvelope>;
  open(envelope: VaultEnvelope): Promise<VaultIdentity>;
}
