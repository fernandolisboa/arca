import { fallbackExclusions } from '@arca/security-policy';
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import type { PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { pushNotice, pushPayload } from './push-notice.js';

declare const self: ServiceWorkerGlobalScope;
/** Every built static file with its content hash, written in by vite.config.ts. */
declare const precacheManifest: PrecacheEntry[];

// A new version takes over open tabs at once. An old tab then loses its lazy chunks, which the
// server answers with a 404, and reloads into the new version (main.tsx).
void self.skipWaiting();
clientsClaim();

const shell = '/index.html';

// Workbox matches against the path and the query string, so a prefix ends at `/`, `?` or the end.
const escaped = (prefix: string) => prefix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const excluded = fallbackExclusions.map((prefix) => new RegExp(`^${escaped(prefix)}(?:[/?]|$)`));

// Pages come from the network while online, so a change to the response headers (the CSP above
// all) reaches installed clients on the next load. The precached shell is only the offline
// fallback. Registered before the precache route, which would otherwise answer `/` cache-first.
registerRoute(
  new NavigationRoute(
    async ({ request }) => {
      try {
        return await fetch(request);
      } catch {
        return (await matchPrecache(shell)) ?? Response.error();
      }
    },
    { denylist: excluded },
  ),
);

// Only the built static files are cached. No route caches /v1 or any other response, so API
// responses always come from the network and are never stored (spec 0001, R5).
precacheAndRoute(precacheManifest);
cleanupOutdatedCaches();

// A security notice (spec 0005, R7): worded here from its code, with no link and no remote image.
self.addEventListener('push', (event) => {
  const { title, body, tag } = pushNotice(pushPayload(event.data));
  event.waitUntil(
    self.registration.showNotification(title, { body, tag, icon: '/icons/icon-192.png' }),
  );
});

// Opens the app itself, whatever the notice: an open tab is focused, or a new one starts at home.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const own = open.find((client) => new URL(client.url).origin === self.location.origin);
      if (own !== undefined) await own.focus();
      else await self.clients.openWindow('/');
    })(),
  );
});
