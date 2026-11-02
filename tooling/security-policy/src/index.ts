/**
 * The response header policy and the SPA fallback exclusions, as data (spec 0001, R4). The Nitro
 * config applies them to every response; native builds will inject the same CSP as a meta tag
 * with the API origin added to connect-src, since a wrapped bundle gets no response headers.
 */

const contentSecurityPolicyDirectives = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'connect-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
  'require-trusted-types-for': ["'script'"],
  'trusted-types': ['arca'],
} as const satisfies Record<string, readonly string[]>;

export const contentSecurityPolicy = Object.entries(contentSecurityPolicyDirectives)
  .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
  .join('; ');

/** Denied until a feature needs them. */
const deniedFeatures = ['camera', 'microphone', 'geolocation'] as const;

export const securityHeaders: Readonly<Record<string, string>> = {
  'content-security-policy': contentSecurityPolicy,
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': deniedFeatures.map((feature) => `${feature}=()`).join(', '),
};

/**
 * Path prefixes that never fall back to the SPA's index.html: an unmatched path under them is a
 * 404. `/.well-known` also holds the Workflow SDK's routes (`/.well-known/workflow/…`).
 */
export const fallbackExclusions = ['/v1', '/internal', '/.well-known'] as const;
