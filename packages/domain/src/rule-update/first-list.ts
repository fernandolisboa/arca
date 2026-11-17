import type { OfficialDomainList } from '../rules/route-version.js';
import { hostMatches } from '../rules/validate.js';

/**
 * A suffix under which anyone may register, such as `gov.lt` or `com.br`, which would make every
 * site under it official. Without a public-suffix dataset, the common second-level labels.
 */
const registrySuffix =
  /^(?:[a-z]{2,63}|(?:com|net|org|co|gov|edu|ac|gob|go|or|ne|mil|nic)\.[a-z]{2})$/;

export const isRegistrySuffix = (host: string): boolean => registrySuffix.test(host);

/**
 * The hosts an admin named through a new-route request's links, which a new country's research
 * starts on (ADR-0031): each link's host, never a registry suffix.
 */
export function namedHosts(
  links: readonly string[],
  hostOf: (url: string) => string | undefined,
): string[] {
  const hosts = links.flatMap((link) => {
    const host = hostOf(link);
    return host === undefined || isRegistrySuffix(host) ? [] : [host];
  });
  return [...new Set(hosts)];
}

/** The most hosts a country's first official-domain list holds. */
export const maxFirstListHosts = 20;

/** Which hosts a first list may hold, and where its registry proofs may sit (ADR-0031). */
export interface FirstListTrust {
  /** The hosts the admin named in the request: the list holds only these or their subdomains. */
  readonly namedHosts: readonly string[];
  /** The hosts of the imported official-domain lists, which a proof may also sit on. */
  readonly importedHosts: readonly string[];
  /** The host official-source matching reads, as the knowledge build reads it. */
  readonly hostOf: (url: string) => string | undefined;
}

/**
 * Checks a country's first official-domain list before any page is read (ADR-0031; spec 0002, R6):
 * at most `maxFirstListHosts` hosts, each a host the admin named or a subdomain of one and never a
 * registry suffix, so research never widens what it may read past what a person typed; and each
 * cites its proof on a host the admin named or on an imported list, never on a host of the same
 * list, a subdomain of one or a parent of one, since a first list cites a registry, never itself.
 * One line per problem.
 */
export function firstListProblems(list: OfficialDomainList, trust: FirstListTrust): string[] {
  if (list.hosts.length > maxFirstListHosts) {
    return [`domainList/hosts: At most ${String(maxFirstListHosts)} hosts`];
  }
  const own = list.hosts.map(({ host }) => host);
  const trusted = [...trust.namedHosts, ...trust.importedHosts];
  return list.hosts.flatMap(({ host, source }, index) => {
    const path = `domainList/hosts/${String(index)}`;
    if (isRegistrySuffix(host)) return [`${path}: ${host} is a registry suffix, not a host`];
    if (!hostMatches(host, trust.namedHosts)) {
      return [`${path}: ${host} is not a host the admin named or a subdomain of one`];
    }
    const proof = trust.hostOf(source.url);
    if (proof === undefined) return [`${path}/source/url: An https address`];
    if (hostMatches(proof, own) || own.some((listed) => hostMatches(listed, [proof]))) {
      return [`${path}/source/url: A registry page, not a host of the same list or its parent`];
    }
    // A page that echoes its own address, such as a search or a not-found page, names anything.
    if (/[?#]/.test(source.url) || source.url.toLowerCase().includes(host)) {
      return [
        `${path}/source/url: A registry page whose address has no query and does not name ${host}`,
      ];
    }
    return hostMatches(proof, trusted)
      ? []
      : [`${path}/source/url: A page on a host the admin named or on an imported list`];
  });
}

const hostLabelChar = /[a-z0-9-]/;

/**
 * Whether a registry page names the host: the host appears in its text as a whole name, so
 * `gov.example` is not found inside `notgov.example`, `portal.gov.example` or `gov.example.org`;
 * a full stop that ends a sentence after it still counts.
 */
export function registryNamesHost(pageText: string, host: string): boolean {
  const text = pageText.toLowerCase();
  const at = (index: number) => text[index] ?? '';
  for (let start = text.indexOf(host); start >= 0; start = text.indexOf(host, start + 1)) {
    const end = start + host.length;
    const joinedBefore = hostLabelChar.test(at(start - 1)) || at(start - 1) === '.';
    const joinedAfter =
      hostLabelChar.test(at(end)) || (at(end) === '.' && hostLabelChar.test(at(end + 1)));
    if (!joinedBefore && !joinedAfter) return true;
  }
  return false;
}
