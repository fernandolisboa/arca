import { fallbackExclusions } from '@arca/security-policy';
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import type { PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;
/** Every built static file with its content hash, written in by vite.config.ts. */
declare const precacheManifest: PrecacheEntry[];

// A new version takes over open tabs at once. Safe while the app is one chunk; before code
// splitting, replace this with an update prompt, since old tabs would lose their lazy chunks.
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
