import { capabilitiesFrom, type Capabilities } from './capabilities.js';

/** What the browser offers, found by feature detection only, never from the user agent. */
export interface WebFeatures {
  readonly pushApi: boolean;
  readonly serviceWorker: boolean;
  /** Running as an installed app (display mode `standalone`). */
  readonly standalone: boolean;
  readonly keyStorage: boolean;
  readonly webShare: boolean;
}

export function detectWebFeatures(scope: typeof globalThis = globalThis): WebFeatures {
  const navigator = scope.navigator as Navigator & { readonly standalone?: boolean };
  return {
    pushApi: 'PushManager' in scope && 'Notification' in scope && 'serviceWorker' in navigator,
    serviceWorker: 'serviceWorker' in navigator,
    standalone:
      scope.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    keyStorage: 'indexedDB' in scope && scope.isSecureContext && 'subtle' in scope.crypto,
    webShare: typeof navigator.share === 'function',
  };
}

/**
 * Receiving shared files stays unavailable until the manifest declares a share target. Without the
 * Push API, a browser with service workers may gain it once the app is installed, as on iOS.
 */
export function webCapabilities(features: WebFeatures): Capabilities {
  return capabilitiesFrom({
    keyStorage: features.keyStorage ? undefined : 'unsupported',
    notifications: features.pushApi
      ? undefined
      : features.serviceWorker && !features.standalone
        ? 'needs-install'
        : 'unsupported',
    receiveSharedFiles: 'unsupported',
    sharing: features.webShare ? undefined : 'unsupported',
  });
}
