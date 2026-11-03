// No imports: the knowledge build imports this as `@arca/scripts/host` and runs it without a build.

/**
 * The URL as written: `https://`, then a host with no user information, port, backslash, extra
 * slash, percent-encoding or full-width dot, which WHATWG parsing would otherwise forgive or map.
 * The host a reviewer reads is then the host matched, up to case, punycode and IDNA mapping.
 */
const plainAuthority = /^https:\/\/[^/?#\\@:%\s\u3002\uff0e\uff61]+(?:[/?#]|$)/;

/**
 * The host official-source matching reads (spec 0002, R4): WHATWG URL parsing lowercases the host
 * and converts it to ASCII (punycode). Anything but `https` without user information or an explicit
 * port has no host to match.
 */
export function hostOf(url: string): string | undefined {
  if (!URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    !plainAuthority.test(url)
  ) {
    return undefined;
  }
  return parsed.hostname;
}
