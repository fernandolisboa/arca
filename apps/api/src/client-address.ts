import { isIPv4, isIPv6 } from 'node:net';
import type { DeploymentEnvironment } from './config.js';

/** A client the limiter cannot tell apart from others shares this one counter. */
const unknownClient = 'unknown';

const mappedIPv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** The first four groups of an IPv6 address, which one subscriber usually holds as a whole. */
function prefix64(address: string): string {
  const [head = '', tail] = address.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(':')}::/64`;
}

/**
 * One counter per client: an IPv4 address (IPv4-mapped IPv6 included), or an IPv6 /64, since a
 * single subscriber can rotate through the addresses of its prefix at will.
 */
export function rateLimitSubject(address: string): string | undefined {
  const mapped = mappedIPv4.exec(address)?.[1];
  if (mapped !== undefined && isIPv4(mapped)) return mapped;
  if (isIPv4(address)) return address;
  if (isIPv6(address)) return prefix64(address.toLowerCase());
  return undefined;
}

/**
 * The client's IP address, for rate limits only: it is HMACed before it is stored and never
 * logged (spec 0003, R10). On Vercel the edge sets `x-vercel-forwarded-for` and overwrites what a
 * client sends, so it cannot be spoofed. A local server has one client, so every request counts
 * toward the same limits. `onUnknown` reports the shared fallback, which should never happen on
 * Vercel and would let one client lock everyone out.
 */
export function clientAddressFor(environment: DeploymentEnvironment, onUnknown: () => void) {
  return (headers: Headers): string => {
    if (environment === 'development') return 'local';
    const forwarded = headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? '';
    const subject = rateLimitSubject(forwarded);
    if (subject !== undefined) return subject;
    onUnknown();
    return unknownClient;
  };
}
