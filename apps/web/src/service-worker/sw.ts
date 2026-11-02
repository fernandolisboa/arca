import { fallbackExclusions } from '@arca/security-policy';
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;
/** Every built static file with its content hash, written in by vite.config.ts. */
declare const precacheManifest: PrecacheEntry[];

void self.skipWaiting();
clientsClaim();

// Only the built static files are cached. No route handles /v1 or any other request, so API
// responses always come from the network and are never stored (spec 0001, R5).
precacheAndRoute(precacheManifest);
cleanupOutdatedCaches();

const escaped = (prefix: string) => prefix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: fallbackExclusions.map((prefix) => new RegExp(`^${escaped(prefix)}(?:/|$)`)),
  }),
);
