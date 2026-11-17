import { type ReadPage, addressPages, asDataText } from '@arca/domain';
import { addressesAsRead } from '../check/answer-text.js';
import { type FetchOutcome, type SourceFetcher } from '../check/fetcher.js';
import { fetchPages } from '../check/read-pages.js';

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
