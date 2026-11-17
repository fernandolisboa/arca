import { type FetchOutcome, type SourceFetcher, fetchLimits } from './fetcher.js';

/**
 * The pages of a machine-readable address read in order and joined into one text, within the
 * per-page text cap, as one long law an official API serves in pages; the first page that fails
 * fails the whole, so no item is checked on part of a law.
 */
export async function fetchPages(
  fetcher: SourceFetcher,
  pages: readonly string[],
  hosts: readonly string[],
): Promise<FetchOutcome> {
  if (pages.length === 0) return { ok: false, failure: 'no_text', status: null, chain: [] };
  const texts: string[] = [];
  const chain: string[] = [];
  let status = 0;
  let cut = false;
  let length = 0;
  for (const page of pages) {
    if (length >= fetchLimits.maxTextLength) {
      cut = true;
      break;
    }
    const read = await fetcher.fetch(page, hosts);
    chain.push(...read.chain);
    if (!read.ok) return { ...read, chain };
    if (texts.length === 0) status = read.status;
    texts.push(read.text);
    cut ||= read.cut;
    length += read.text.length + 1;
  }
  const text = texts.join('\n');
  return {
    ok: true,
    status,
    text: text.slice(0, fetchLimits.maxTextLength),
    cut: cut || text.length > fetchLimits.maxTextLength,
    chain,
  };
}
