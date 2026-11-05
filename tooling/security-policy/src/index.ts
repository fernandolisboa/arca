/**
 * The response header policy and the SPA fallback exclusions, as data (spec 0001, R4). The Nitro
 * config applies them to every response; native builds will inject the same CSP as a meta tag
 * with the API origin added to connect-src and without `report-to`, which a meta tag cannot carry,
 * since a wrapped bundle gets no response headers.
 */

/** Where browsers send CSP and Trusted Types violation reports (spec 0004, R5). */
export const cspReportPath = '/internal/monitoring/csp';
const cspReportGroup = 'csp';

const contentSecurityPolicyDirectives = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  // Vault uploads go to Vercel Blob's API and downloads come from a private store's own host
  // (spec 0005, R4), both through short-lived presigned URLs.
  'connect-src': [
    "'self'",
    'https://vercel.com/api/blob/',
    'https://*.private.blob.vercel-storage.com',
  ],
  'img-src': ["'self'", 'data:'],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
  'require-trusted-types-for': ["'script'"],
  'trusted-types': ['arca'],
  'report-to': [cspReportGroup],
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
  'reporting-endpoints': `${cspReportGroup}="${cspReportPath}"`,
};

/**
 * Path prefixes that never fall back to the SPA's index.html: an unmatched path under them is a
 * 404. `/.well-known` also holds the Workflow SDK's routes (`/.well-known/workflow/…`).
 */
export const fallbackExclusions = ['/v1', '/internal', '/.well-known'] as const;

/**
 * Built web files that are never published or precached: dotfiles, and the source maps the
 * bundle check reads. Globs for Nitro's public assets; the predicate for the service worker.
 */
export const unpublishedFiles = ['**/.*', '**/*.map'];

export function isUnpublishedFile(path: string): boolean {
  return path.endsWith('.map') || path.split('/').some((part) => part.startsWith('.'));
}
