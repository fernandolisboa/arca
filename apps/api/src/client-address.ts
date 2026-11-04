import type { DeploymentEnvironment } from './config.js';

/** A client the limiter cannot tell apart from others shares this one counter. */
const unknownClient = 'unknown';

/**
 * The client's IP address, for rate limits only: it is HMACed before it is stored and never
 * logged (spec 0003, R10). On Vercel the edge sets `x-vercel-forwarded-for` and overwrites what a
 * client sends, so it cannot be spoofed. A local server has one client, so every request counts
 * toward the same limits.
 */
export function clientAddressFor(environment: DeploymentEnvironment) {
  return (headers: Headers): string => {
    if (environment === 'development') return 'local';
    const forwarded = headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
    return forwarded === undefined || forwarded === '' ? unknownClient : forwarded;
  };
}
