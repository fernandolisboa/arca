/**
 * The URL as written: `https://`, then a host with no user information, port, backslash, extra
 * slash, percent-encoding or full-width dot, which WHATWG parsing would otherwise forgive or map.
 */
const plainAuthority = /^https:\/\/[^/?#\\@:%\s。．｡]+(?:[/?#]|$)/;

/**
 * The host official-source matching reads (spec 0002, R4), as the knowledge build reads it with
 * `hostOf` from `@arca/scripts/host`, which the API may not import at runtime; a test holds the two
 * to the same answers. WHATWG URL parsing lowercases the host and converts it to ASCII (punycode).
 * Anything but `https` without user information or an explicit port has no host to match.
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
