import type { Capabilities } from './capabilities.js';
import type { DeepLinks } from './deep-links.js';
import type { DocumentCapture, FilePicking } from './files.js';
import type { KeyStorage } from './key-storage.js';
import type { Notifications } from './notifications.js';
import type { SharedFiles, Sharing } from './sharing.js';
import type { VaultEnvelopes } from './vault-envelopes.js';
import { detectWebFeatures, webCapabilities } from './web-capabilities.js';
import { createWebDeepLinks } from './web-deep-links.js';
import { createWebDocumentCapture, createWebFilePicking } from './web-files.js';
import { createWebKeyStorage } from './web-key-storage.js';
import { createWebNotifications } from './web-notifications.js';
import { createWebSharedFiles, createWebSharing } from './web-sharing.js';
import { createWebVaultEnvelopes } from './web-vault-envelopes.js';

/** Every capability port, as one runtime's adapters provide them. */
export interface Platform {
  readonly capabilities: Capabilities;
  readonly documentCapture: DocumentCapture;
  readonly filePicking: FilePicking;
  readonly keyStorage: KeyStorage;
  readonly notifications: Notifications;
  readonly sharedFiles: SharedFiles;
  readonly sharing: Sharing;
  readonly deepLinks: DeepLinks;
  readonly vaultEnvelopes: VaultEnvelopes;
}

export function createWebPlatform(scope: typeof globalThis = globalThis): Platform {
  const capabilities = webCapabilities(detectWebFeatures(scope));
  return {
    capabilities,
    documentCapture: createWebDocumentCapture(capabilities, scope.document),
    filePicking: createWebFilePicking(capabilities, scope.document),
    keyStorage: createWebKeyStorage(capabilities, scope),
    notifications: createWebNotifications(capabilities, scope),
    sharedFiles: createWebSharedFiles(capabilities),
    sharing: createWebSharing(capabilities, scope),
    deepLinks: createWebDeepLinks(capabilities, scope.location.origin),
    vaultEnvelopes: createWebVaultEnvelopes(scope.location.hostname),
  };
}
