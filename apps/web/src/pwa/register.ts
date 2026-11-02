import { trustedServiceWorkerUrl } from './trusted-types.js';

/**
 * Registers the service worker once the page has loaded. Our own code, not a plugin's injected
 * script, so the URL goes through the `arca` Trusted Types policy (spec 0001, R5).
 */
export function registerServiceWorker(): void {
  // The worker exists only in the production build.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = () => {
    // The app works without the worker; the next load tries again.
    try {
      navigator.serviceWorker
        .register(trustedServiceWorkerUrl(), { scope: '/' })
        .catch(() => undefined);
    } catch {
      // The policy could not be created (for example, the CSP disallows it).
    }
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
