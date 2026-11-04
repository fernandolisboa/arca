export {
  generateVaultIdentity,
  InvalidVaultIdentity,
  recipientFingerprint,
  recipientOf,
  type VaultIdentity,
} from './identity.js';
export {
  decryptDocument,
  encryptDocument,
  InvalidRecipients,
  reencryptDocument,
} from './documents.js';
export {
  generateRecoverySecret,
  normalizeRecoverySecret,
  openRecoveryEnvelope,
  sealRecoveryEnvelope,
  WrongRecoverySecret,
} from './recovery.js';
export {
  InvalidSharingState,
  nextSharingStateVersion,
  parseSharingState,
  serializeSharingState,
  sharingStateChanges,
  tagSharingState,
  verifySharingState,
  type SharingState,
  type SharingStateChanges,
  type SharingStateCheck,
  type TaggedSharingState,
} from './sharing-state.js';
