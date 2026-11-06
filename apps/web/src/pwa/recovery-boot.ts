/*
 * A classic same-origin script that runs before the app's module script executes. When that
 * script or a module it imports fails to load, the page would stay blank, so this deletes the
 * caches and loads the page once more from the network. The worker stays registered: dropping it
 * would end this browser's push subscription (spec 0005, R7), and with its caches empty the
 * precache answers from the network.
 */
import { recoverOnce } from './recover.js';

async function emptyCaches(): Promise<void> {
  if (!('caches' in window)) return;
  await Promise.all((await caches.keys()).map((name) => caches.delete(name)));
}

window.addEventListener(
  'error',
  ({ target }) => {
    // A load failure fires on the element and does not bubble; offline, the caches are all there is.
    if (!(target instanceof HTMLScriptElement) || target.type !== 'module' || !navigator.onLine) {
      return;
    }
    recoverOnce(
      'entry',
      () => sessionStorage,
      Date.now(),
      () => {
        void emptyCaches()
          .catch(() => undefined)
          .finally(() => {
            location.reload();
          });
      },
    );
  },
  true,
);
