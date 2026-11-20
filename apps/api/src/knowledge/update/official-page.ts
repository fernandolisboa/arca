import { type CheckItem, type ReadPage, addressPages, asDataText } from '@arca/domain';
import { addressesAsRead } from '../pages/answer-text.js';
import { type FetchOutcome, type SourceFetcher } from '../pages/fetcher.js';
import { fetchPages } from '../pages/read-pages.js';

/**
 * Reads one cited official page with the guarded fetcher, on the hosts allowed for it: through its
 * machine-readable address when the version names one, else as itself. A page that was read comes
 * back as the quote checks read it, its text marked as data (ADR-0031).
 */
export async function readOfficialPage(
  fetcher: SourceFetcher,
  url: string,
  address: string | undefined,
  allowed: readonly string[],
): Promise<{ readonly outcome: FetchOutcome; readonly page: ReadPage | undefined }> {
  const outcome =
    address === undefined
      ? await fetcher.fetch(url, allowed)
      : await fetchPages(fetcher, addressPages(address), allowed);
  return {
    outcome,
    page: outcome.ok
      ? {
          url,
          text: asDataText(outcome.text),
          cut: outcome.cut,
          chain: outcome.chain,
          echoes: addressesAsRead(outcome.chain).map(asDataText),
        }
      : undefined,
  };
}

/**
 * The hosts each cited page may be read on: those of the official-domain lists of every item
 * that cites it, so a page two items cite is read only on the hosts both allow.
 */
export function hostsByUrl(
  items: readonly CheckItem[],
  hostsOf: (pins: CheckItem['officialDomains']) => readonly string[] | undefined,
): Map<string, string[]> {
  const hosts = new Map<string, string[]>();
  for (const item of items) {
    const allowed = hostsOf(item.officialDomains) ?? [];
    for (const url of item.urls) {
      const before = hosts.get(url);
      hosts.set(
        url,
        before === undefined ? [...allowed] : before.filter((host) => allowed.includes(host)),
      );
    }
  }
  return hosts;
}
