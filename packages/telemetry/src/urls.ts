import { httpMethod, oneOf } from './shapes.js';

/** Reduces a URL or path to its route pattern; undefined when it is not one. */
export type UrlReducer = (url: unknown) => string | undefined;

export interface KnownUrlParts {
  /** The app's own static path segments: route names from the API contract and the web routes. */
  readonly segments: Iterable<string>;
  /** The hosts a URL may name: the app's origins and its vendors. */
  readonly hosts: Iterable<string>;
}

const base = 'http://relative.invalid';

/**
 * Keeps a path segment only when it is one of the app's own static segments; any other segment,
 * which may be an ID, a token or a name, becomes `:param`. A host outside the known ones becomes
 * `:host`, since a host name can carry data too (`<cpf>.<name>.attacker.example`). The query and
 * fragment are always dropped, and anything that is not a path or an http(s) URL is dropped whole.
 */
export function urlReducer({ segments, hosts }: KnownUrlParts): UrlReducer {
  const known = new Set(segments);
  const knownHosts = new Set(hosts);
  return (url) => {
    if (typeof url !== 'string' || url.length > 2048 || !/^(?:\/|https?:\/\/)/i.test(url)) {
      return undefined;
    }
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
    if (parsed.origin === base) return `/${path}`;
    const host = knownHosts.has(parsed.host) ? parsed.host : ':host';
    return `${parsed.protocol}//${host}/${path}`;
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

/** What a CSP report names instead of a URL: a keyword, or the bare scheme of a non-HTTP one. */
export const blockedKeyword = oneOf([
  'inline',
  'eval',
  'wasm-eval',
  'trusted-types-policy',
  'trusted-types-sink',
  'data',
  'blob',
  'self',
  'about',
  'filesystem',
  'ws',
  'wss',
  'chrome-extension',
  'moz-extension',
  'safari-web-extension',
]);
