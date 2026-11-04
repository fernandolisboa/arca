import type { VaultIdentity } from '@arca/vault';
import { base64urlnopad, bech32 } from '@scure/base';
import { Decrypter, Encrypter, webauthn } from 'age-encryption';
import {
  EnvelopeNotOpenedError,
  type VaultEnvelope,
  type VaultEnvelopes,
} from './vault-envelopes.js';

const identityPrefix = 'AGE-PLUGIN-FIDO2PRF-';
const identityVersion = 1;
const cborUnsigned = 0;
const cborBytes = 2;
const cborText = 3;
const cborArray = 4;

function cborHead(majorType: number, argument: number): number[] {
  const type = majorType << 5;
  if (argument < 24) return [type | argument];
  if (argument < 0x100) return [type | 24, argument];
  if (argument < 0x10000) return [type | 25, argument >> 8, argument & 0xff];
  throw new RangeError('CBOR argument too large');
}

/**
 * The `fido2prf` identity string for a passkey: bech32 over CBOR version 1, the credential ID,
 * the relying-party ID and no transport hints. `age-encryption` builds this string only inside
 * `createCredential`, and Arca's passkeys are registered at sign-up, so the adapter encodes it;
 * the library decodes and checks it on every use, and pinned vectors fix the encoding.
 */
export function fido2prfIdentity(credentialId: string, relyingPartyId: string): string {
  const credential = base64urlnopad.decode(credentialId);
  const relyingParty = new TextEncoder().encode(relyingPartyId);
  const data = Uint8Array.from([
    ...cborHead(cborUnsigned, identityVersion),
    ...cborHead(cborBytes, credential.length),
    ...credential,
    ...cborHead(cborText, relyingParty.length),
    ...relyingParty,
    ...cborHead(cborArray, 0),
  ]);
  return bech32.encode(identityPrefix, bech32.toWords(data), false).toUpperCase();
}

/**
 * The web adapter: `age-encryption`'s WebAuthn recipient and identity run the PRF ceremony,
 * with user verification required, and the PRF output never leaves the library (ADR-0018).
 */
export function createWebVaultEnvelopes(relyingPartyId: string): VaultEnvelopes {
  const identityOf = (credentialId: string) => ({
    identity: fido2prfIdentity(credentialId, relyingPartyId),
  });
  return {
    async seal(identity: VaultIdentity, credentialId: string): Promise<VaultEnvelope> {
      const encrypter = new Encrypter();
      encrypter.addRecipient(new webauthn.WebAuthnRecipient(identityOf(credentialId)));
      return { credentialId, bytes: await encrypter.encrypt(identity) };
    },
    async open(envelope: VaultEnvelope): Promise<VaultIdentity> {
      try {
        const decrypter = new Decrypter();
        decrypter.addIdentity(new webauthn.WebAuthnIdentity(identityOf(envelope.credentialId)));
        return (await decrypter.decrypt(envelope.bytes)) as VaultIdentity;
      } catch (error) {
        throw new EnvelopeNotOpenedError('the envelope did not open', { cause: error });
      }
    },
  };
}
