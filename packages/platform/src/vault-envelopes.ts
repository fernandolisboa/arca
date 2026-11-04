import type { VaultIdentity } from '@arca/vault';

/** A vault identity sealed to one passkey (ADR-0018). The bytes are a plain age file. */
export interface VaultEnvelope {
  readonly credentialId: string;
  readonly bytes: Uint8Array;
}

/** The envelope did not open: another passkey, a changed envelope, or a cancelled ceremony. */
export class EnvelopeNotOpenedError extends Error {
  override name = 'EnvelopeNotOpenedError';
}

/**
 * Seals and opens vault identities with a passkey's PRF output, which never leaves this port
 * (spec 0005, R5). The only producer of passkey envelopes.
 */
export interface VaultEnvelopes {
  seal(identity: VaultIdentity, credentialId: string): Promise<VaultEnvelope>;
  open(envelope: VaultEnvelope): Promise<VaultIdentity>;
}
