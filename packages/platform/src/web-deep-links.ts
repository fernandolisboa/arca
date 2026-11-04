import { requireCapability, type Capabilities } from './capabilities.js';
import { appLink, type DeepLinks } from './deep-links.js';

/** On the web a deep link is the page's URL, which the router reads; nothing arrives later. */
export function createWebDeepLinks(
  capabilities: Capabilities,
  origin: string = globalThis.location.origin,
): DeepLinks {
  return {
    linkTo(path) {
      requireCapability(capabilities, 'deepLinks');
      return appLink(path, origin);
    },
    listen() {
      requireCapability(capabilities, 'deepLinks');
      return () => undefined;
    },
  };
}
