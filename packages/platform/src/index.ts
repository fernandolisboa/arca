export {
  CapabilityUnavailableError,
  capabilities,
  type Capabilities,
  type Capability,
  type Unavailability,
} from './capabilities.js';
export { NotAnAppPathError, type DeepLinks } from './deep-links.js';
export type { DocumentCapture, FilePicking, PickOptions } from './files.js';
export type { KeyContext, KeyStorage, StoredSecret } from './key-storage.js';
export {
  NotificationsDeniedError,
  type NotificationPermission,
  type Notifications,
  type PushChannel,
} from './notifications.js';
export {
  createPasskeys,
  PasskeyOptionsRefusedError,
  type AuthenticationResponseJSON,
  type Passkeys,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type WebAuthnBrowser,
} from './passkeys.js';
export type { ShareContent, SharedFiles, Sharing } from './sharing.js';
export {
  EnvelopeNotOpenedError,
  EnvelopeNotSealedError,
  type EnvelopeFailure,
  type VaultEnvelope,
  type VaultEnvelopes,
} from './vault-envelopes.js';
export { detectWebFeatures, webCapabilities, type WebFeatures } from './web-capabilities.js';
export { createWebDeepLinks } from './web-deep-links.js';
export { createWebPasskeys } from './web-passkeys.js';
export { createWebPlatform, type Platform } from './web-platform.js';
export { createWebVaultEnvelopes } from './web-vault-envelopes.js';
