import { trustedServiceWorkerUrl } from './trusted-types.js';

/**
 * Registers the service worker once the page has loaded. Our own code, not a plugin's injected
 * script, so the URL goes through the `arca` Trusted Types policy (spec 0001, R5).
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register(trustedServiceWorkerUrl(), { scope: '/' }).catch(() => {
      // The app works without it; the next load tries again.
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
