import { httpMethod, oneOf } from './shapes.js';

/** Reduces a URL or path to its route pattern; undefined when it is not one. */
export type UrlReducer = (url: unknown) => string | undefined;

const hostPattern = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::[0-9]{1,5})?$/;
const base = 'http://relative.invalid';

/**
 * Keeps a path segment only when it is one of the app's own static segments (route names from
 * the API contract and the web routes); any other segment, which may be an ID, a token or a name,
 * becomes `:param`. The query and fragment are always dropped, and a host is kept only when it is
 * shaped like one.
 */
export function urlReducer(staticSegments: Iterable<string>): UrlReducer {
  const known = new Set(staticSegments);
  return (url) => {
    if (typeof url !== 'string' || url.length > 2048) return undefined;
    let parsed: URL;
    try {
      parsed = new URL(url, base);
    } catch {
      return undefined;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    const path = parsed.pathname
      .split('/')
      .slice(1)
      .map((segment) => (known.has(segment) ? segment : segment === '' ? '' : ':param'))
      .join('/');
    const relative = parsed.origin === base;
    if (relative) return `/${path}`;
    return hostPattern.test(parsed.host) ? `${parsed.protocol}//${parsed.host}/${path}` : undefined;
  };
}

/** A transaction or span name: an optional method, then a URL reduced to its route. */
export const nameReducer =
  (reduce: UrlReducer) =>
  (name: unknown): string | undefined => {
    if (typeof name !== 'string') return undefined;
    const space = name.indexOf(' ');
    const method = name.slice(0, space);
    if (space === -1 || !httpMethod(method)) return reduce(name);
    const route = reduce(name.slice(space + 1));
    return route === undefined ? undefined : `${method} ${route}`;
  };

/** What a CSP report names instead of a URL when the blocked resource has none. */
export const blockedKeyword = oneOf([
  'inline',
  'eval',
  'wasm-eval',
  'trusted-types-policy',
  'trusted-types-sink',
  'data',
  'blob',
  'self',
]);
