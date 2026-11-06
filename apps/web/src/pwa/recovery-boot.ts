/*
 * Runs in <head> before the app's module script, as a classic same-origin script. When that script
 * or a module it imports fails to load, the page would stay blank, so this drops the service
 * worker and its caches and loads the page once more from the network.
 */
import { recoverOnce } from './recover.js';

async function startOver(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if ('caches' in window) {
    await Promise.all((await caches.keys()).map((name) => caches.delete(name)));
  }
}

window.addEventListener(
  'error',
  ({ target }) => {
    // A load failure fires on the element and does not bubble; offline, the caches are all there is.
    if (!(target instanceof HTMLScriptElement) || target.type !== 'module' || !navigator.onLine) {
      return;
    }
    recoverOnce(
      () => sessionStorage,
      Date.now(),
      () => {
        void startOver()
          .catch(() => undefined)
          .finally(() => {
            location.reload();
          });
      },
    );
  },
  true,
);
