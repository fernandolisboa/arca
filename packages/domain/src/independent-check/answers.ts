import type { CheckItem } from './items.js';
import { type CheckValue, statesValue } from './values.js';

export const checkStatuses = ['matches', 'differs', 'could_not_check'] as const;
export type CheckStatus = (typeof checkStatuses)[number];

/** One entry of a model's answer, as the closed answer schema parses it; still untrusted. */
export interface CheckAnswer {
  readonly key: string;
  readonly status: CheckStatus;
  readonly quote?: string | undefined;
  readonly url?: string | undefined;
  readonly note?: string | undefined;
}

/** A cited page as the run read it: the exact text the model was sent for its URL. */
export interface ReadPage {
  /** The cited URL, as the version writes it. */
  readonly url: string;
  readonly text: string;
  /** The text was cut at the size cap, so a match on it cannot be trusted. */
  readonly cut: boolean;
  /** Every URL requested on the way, the cited one first and the final one last. */
  readonly chain: readonly string[];
}

/** Why code did not take the model's word for an item. */
export const checkReasons = [
  'not_answered',
  'model_could_not_check',
  'url_not_cited',
  'page_not_read',
  'page_cut',
  'quote_length',
  'quote_not_on_page',
  'echoes_address',
  'value_not_in_quote',
] as const;
export type CheckReason = (typeof checkReasons)[number];

/** One item of a report: what code concluded from the model's answer and the pages. */
export interface CheckedItem {
  readonly key: string;
  readonly status: CheckStatus;
  /** The verified quote, on matches and differs only. */
  readonly quote: string | null;
  readonly url: string | null;
  /** The model's short note, on differs only, with links and host names taken out. */
  readonly note: string | null;
  readonly reason: CheckReason | null;
}

export const minQuoteLength = 12;
export const maxQuoteLength = 800;
export const maxNoteLength = 300;
/** A query value this long or longer, found in a quote, means the page may echo its address. */
const echoedQueryLength = 4;

/** Whitespace runs as one space, in Unicode NFC, so line breaks never decide a match. */
export function normalizeWhitespace(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

function queryValues(url: string): string[] {
  const query = /\?([^#]*)/.exec(url)?.[1] ?? '';
  return query
    .split('&')
    .map((pair) => decoded(pair.slice(pair.indexOf('=') + 1)))
    .map(normalizeWhitespace)
    .filter((value) => value.length >= echoedQueryLength);
}

/**
 * A page that writes its own address into its text could be made to "say" anything by the address
 * alone: a quote holding a query value of the chain, or an item's value that the chain's addresses
 * already state, proves nothing about the law.
 */
function echoesAddress(quote: string, chain: readonly string[], values: readonly CheckValue[]) {
  const lower = quote.toLowerCase();
  return chain.some(
    (url) =>
      queryValues(url).some((value) => lower.includes(value.toLowerCase())) ||
      values.some((value) => statesValue(value, decoded(url))),
  );
}

/** Links, addresses and host names out of a note, angle brackets too, then capped. */
export function plainNote(note: string): string | null {
  const plain = normalizeWhitespace(
    note
      .replace(/[a-z][a-z0-9+.-]*:\/{0,2}\S+/giu, ' ')
      .replace(/\bwww\.\S+/giu, ' ')
      .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,63}\b\S*/giu, ' ')
      .replace(/[<>]/g, ' '),
  );
  if (plain === '') return null;
  return plain.length > maxNoteLength ? `${plain.slice(0, maxNoteLength - 1).trimEnd()}…` : plain;
}

const unchecked = (key: string, reason: CheckReason): CheckedItem => ({
  key,
  status: 'could_not_check',
  quote: null,
  url: null,
  note: null,
  reason,
});

function verifyOne(
  item: CheckItem,
  answer: CheckAnswer | undefined,
  pages: ReadonlyMap<string, ReadPage>,
): CheckedItem {
  if (answer === undefined) return unchecked(item.key, 'not_answered');
  if (answer.status === 'could_not_check') return unchecked(item.key, 'model_could_not_check');
  const { url } = answer;
  if (url === undefined || !item.urls.includes(url)) return unchecked(item.key, 'url_not_cited');
  const page = pages.get(url);
  if (page === undefined) return unchecked(item.key, 'page_not_read');
  const quote = normalizeWhitespace(answer.quote ?? '');
  if (quote.length < minQuoteLength || quote.length > maxQuoteLength) {
    return unchecked(item.key, 'quote_length');
  }
  if (!normalizeWhitespace(page.text).includes(quote)) {
    return unchecked(item.key, 'quote_not_on_page');
  }
  const values = answer.status === 'matches' ? item.values : [];
  if (echoesAddress(quote, page.chain, values)) return unchecked(item.key, 'echoes_address');
  if (answer.status === 'matches') {
    if (page.cut) return unchecked(item.key, 'page_cut');
    if (!item.values.every((value) => statesValue(value, quote))) {
      return unchecked(item.key, 'value_not_in_quote');
    }
    return { key: item.key, status: 'matches', quote, url, note: null, reason: null };
  }
  return {
    key: item.key,
    status: 'differs',
    quote,
    url,
    note: answer.note === undefined ? null : plainNote(answer.note),
    reason: null,
  };
}

/**
 * What a report says about each item (ADR-0027), checked in code: a quote counts only when it is,
 * after whitespace is normalized, a substring of the exact text sent for a URL the item itself
 * cites, within the length limits, echoing no address of its redirect chain, and, for a match,
 * stating every value the item states, from a page that was not cut. An item the model left out,
 * answered twice or failed on is could not be checked; keys of no item are dropped.
 */
export function verifyAnswers(
  items: readonly CheckItem[],
  answers: readonly CheckAnswer[],
  pages: ReadonlyMap<string, ReadPage>,
): CheckedItem[] {
  const counts = new Map<string, number>();
  for (const { key } of answers) counts.set(key, (counts.get(key) ?? 0) + 1);
  const byKey = new Map(
    answers.filter(({ key }) => counts.get(key) === 1).map((answer) => [answer.key, answer]),
  );
  return items.map((item) => verifyOne(item, byKey.get(item.key), pages));
}

/** The model a report is stored under when the scripted checker wrote it, outside production. */
export const scriptedCheckerModel = 'fake';

/**
 * A clean report has at least one item and every item matches. A scripted report is never clean,
 * whatever it says, so nothing outside production can look checked.
 */
export function reportClean(items: readonly Pick<CheckedItem, 'status'>[], model: string): boolean {
  return (
    model !== scriptedCheckerModel &&
    items.length > 0 &&
    items.every((item) => item.status === 'matches')
  );
}
