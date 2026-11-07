import { BlockList, isIP } from 'node:net';

/**
 * IPv4 ranges the IANA special-purpose registry marks as not globally reachable, plus multicast
 * and the reserved block (checked 2026-11-07 against
 * https://www.iana.org/assignments/iana-ipv4-special-registry/).
 */
const refusedV4: readonly [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/**
 * Inside 2000::/3, the only IPv6 unicast space allocated for global use, the ranges the IANA
 * special-purpose registry marks as not globally reachable or that tunnel to an IPv4 address:
 * the IETF protocol block (Teredo included), documentation and 6to4 (checked 2026-11-07 against
 * https://www.iana.org/assignments/iana-ipv6-special-registry/). Everything outside 2000::/3 is
 * refused, which covers loopback, unspecified, IPv4-mapped and -compatible forms, NAT64,
 * unique-local, link-local and multicast.
 */
const refusedV6: readonly [string, number][] = [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
];

const refused = new BlockList();
for (const [address, prefix] of refusedV4) refused.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of refusedV6) refused.addSubnet(address, prefix, 'ipv6');

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

/**
 * Whether the fetcher may connect to an address: a globally reachable unicast one, so a cited
 * official host that resolves to the server's own network, a cloud metadata service or a tunnel
 * to one is never reached (ADR-0027).
 */
export function globallyReachable(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !refused.check(address, 'ipv4');
  if (family === 6) return globalV6.check(address, 'ipv6') && !refused.check(address, 'ipv6');
  return false;
}
