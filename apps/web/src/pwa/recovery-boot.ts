/*
 * A classic same-origin script that runs before the app's module script executes. When that
 * script or a module it imports fails to load, the page would stay blank, so this deletes any
 * page cached in place of a file and loads the page once more. The worker stays registered:
 * dropping it would end this browser's push subscription (spec 0005, R7). The precache answers a
 * deleted entry from the network, and every other entry still works offline.
 */
import { isPageInPlaceOfFile } from './cached-page.js';
import { recoverOnce } from './recover.js';

async function dropPagesInPlaceOfFiles(): Promise<void> {
  if (!('caches' in window)) return;
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (isPageInPlaceOfFile(request.url, response?.headers.get('content-type') ?? null)) {
        await cache.delete(request);
      }
    }
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
      'entry',
      () => sessionStorage,
      Date.now(),
      () => {
        void dropPagesInPlaceOfFiles()
          .catch(() => undefined)
          .finally(() => {
            location.reload();
          });
      },
    );
  },
  true,
);
