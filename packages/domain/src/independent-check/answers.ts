import type { CheckItem } from './items.js';
import { excerptRuns } from './passages.js';
import { type CheckValue, statesValue } from './values.js';

export const checkStatuses = ['matches', 'differs', 'could_not_check'] as const;
export type CheckStatus = (typeof checkStatuses)[number];

/** A passage and the cited page it was copied from. */
export interface CheckQuote {
  readonly quote: string;
  readonly url: string;
}

/** One entry of a model's answer, as the closed answer schema parses it; still untrusted. */
export interface CheckAnswer {
  readonly key: string;
  readonly status: CheckStatus;
  readonly quotes?: readonly CheckQuote[] | undefined;
  readonly note?: string | undefined;
}

/** A cited page as the run read it: the exact text the model was sent for its URL. */
export interface ReadPage {
  /** The cited URL, as the version writes it. */
  readonly url: string;
  readonly text: string;
  /** The text was cut at the size cap, so a match on it cannot be trusted. */
  readonly cut: boolean;
  /** The text is an excerpt: runs of the page with a gap line wherever text is left out. */
  readonly excerpt?: boolean;
  /**
   * Every URL requested on the way, the final one last: the cited one first, or the
   * machine-readable address read in its place.
   */
  readonly chain: readonly string[];
  /**
   * What the reader makes of those addresses when an answer writes one back: each as
   * `addressTexts` gives it, read as the answer's own text is, markup and references included.
   * They are tested as the addresses are, so a claim an address spells as references or between
   * tags is still an echo. A reader that turns markup into text must give them.
   */
  readonly echoes?: readonly string[];
}

/** Why code did not take the model's word for an item. */
export const checkReasons = [
  'no_source_cited',
  'no_page_read',
  'not_answered',
  'model_could_not_check',
  'quote_count',
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
  /** The verified quotes, each with its page, on matches and differs only; empty otherwise. */
  readonly quotes: readonly CheckQuote[];
  /**
   * The model's short note, with links and host names taken out: what differs, or why it could
   * not check. Never on a match, and never when code is what refused the answer.
   */
  readonly note: string | null;
  readonly reason: CheckReason | null;
}

/** An item that joins provisions may rest on a few quotes, never on more than this. */
export const maxQuotes = 3;
export const minQuoteLength = 12;
export const maxQuoteLength = 800;
export const maxNoteLength = 300;
/** A query value this long or longer, found in a quote, means the page may echo its address. */
const echoedQueryLength = 4;

/** Whitespace runs as one space, in Unicode NFC, so line breaks never decide a match. */
export function normalizeWhitespace(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** A server may decode what another already did, so an address is read decoded this many times. */
const decodingRounds = 3;

/**
 * An address as the servers on its way may read it: percent-decoded, and decoded again while that
 * changes it. Undefined when its bytes are not UTF-8, which nothing here could compare with a
 * page's text.
 */
export function addressTexts(url: string): readonly string[] | undefined {
  const texts: string[] = [];
  let last = url;
  for (let round = 0; round < decodingRounds; round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(last.replace(/\+/g, ' '));
    } catch {
      return round === 0 ? undefined : texts;
    }
    if (round > 0 && next === last) break;
    texts.push(next);
    last = next;
  }
  return texts;
}

/** What an address's query says: the text after its question mark, up to a fragment. */
const queryOf = (text: string) => /\?([^#]*)/.exec(text)?.[1] ?? '';

function queryValues(text: string): string[] {
  return queryOf(text)
    .split('&')
    .map((pair) => normalizeWhitespace(pair.slice(pair.indexOf('=') + 1)))
    .filter((value) => value.length >= echoedQueryLength);
}

/** A piece of a quote this long that a query also holds counts as taken from the query. */
const echoedPieceLength = 4;
/** A quote at least this much made of pieces of its addresses' queries says what they say. */
const echoedShare = 0.5;

/** Lower-case letters and digits with one space for anything between them, in any script. */
const lettersAndDigits = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Whether at least half of a quote is made of pieces of the queries requested for its page,
 * whatever punctuation the query or the answer writes between the words: so a quote that is part
 * of a long query value, or put together from several short ones, is caught where the whole-value
 * test alone would let it through. Paths are left out: a path names its page's subject, which the
 * page's own words restate, and no test on the words could tell that from an echo.
 */
function madeOfQuery(quote: string, texts: readonly string[]): boolean {
  const text = lettersAndDigits(quote);
  const queries = texts
    .map((address) => lettersAndDigits(queryOf(address)))
    .filter(({ length }) => length >= echoedPieceLength);
  if (text.length < echoedPieceLength || queries.length === 0) return false;
  const taken = new Uint8Array(text.length);
  for (let start = 0; start + echoedPieceLength <= text.length; start += 1) {
    const piece = text.slice(start, start + echoedPieceLength);
    if (queries.some((query) => query.includes(piece))) {
      taken.fill(1, start, start + echoedPieceLength);
    }
  }
  return taken.reduce((sum, mark) => sum + mark, 0) >= text.length * echoedShare;
}

/** A tag or a character reference opening in an address: text a reader of markup would rewrite. */
const opensMarkup = (text: string) => /<|&#/u.test(text);

/**
 * A page that writes its own address into its text could be made to "say" anything by the address
 * alone: a quote holding a query value of the chain, a quote mostly made of the chain's queries,
 * or an item's value that those addresses already state, proves nothing about the law. The chain
 * starts at the address requested, which for a source read through its machine-readable address
 * is not the page's. An address is compared as every text it may have become: decoded as often as
 * a server might, and as the reader renders it. One that cannot be decoded, or that opens markup
 * of its own, is taken as an echo whatever the quote.
 */
function echoesAddress(quote: string, page: ReadPage, values: readonly CheckValue[]) {
  const decoded = page.chain.map(addressTexts);
  if (decoded.includes(undefined)) return true;
  const addresses = decoded.flatMap((texts) => texts ?? []);
  if (addresses.some(opensMarkup)) return true;
  const texts = [...addresses, ...(page.echoes ?? [])];
  const lower = quote.toLowerCase();
  return (
    madeOfQuery(quote, texts) ||
    texts.some(
      (text) =>
        queryValues(text).some((value) => lower.includes(value.toLowerCase())) ||
        values.some((value) => statesValue(value, text)),
    )
  );
}

const scheme = /^[a-z][a-z0-9+.-]*$/;
// Host names in any script, so one written in Cyrillic or with accents is caught too.
const label = /^[\p{L}\p{N}-]+$/u;
const topLevel = /^\p{L}{2,63}$/u;
const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/u;

/**
 * Whether a word of a note is a link, an address or a host name. Checked word by word with
 * anchored patterns, so a long note never makes a pattern backtrack.
 */
const opening = new Set(['(', '"', "'", '[']);
const closing = new Set(['.', ',', ';', ':', '!', '?', ')', '"', "'", ']']);

function trimmed(text: string, from: ReadonlySet<string>, side: 'start' | 'end'): string {
  let start = 0;
  let end = text.length;
  if (side === 'start') while (start < end && from.has(text.charAt(start))) start += 1;
  else while (end > start && from.has(text.charAt(end - 1))) end -= 1;
  return text.slice(start, end);
}

function pieceLinkLike(piece: string): boolean {
  const lower = trimmed(piece, opening, 'start');
  const colon = lower.indexOf(':');
  if (colon > 0 && scheme.test(lower.slice(0, colon))) return true;
  if (lower.startsWith('www.')) return true;
  const host = trimmed(lower.split(/[/?#]/u)[0] ?? '', closing, 'end');
  if (ipv4.test(host)) return true;
  const labels = host.split('.');
  return (
    labels.length > 1 &&
    labels.every((part) => label.test(part)) &&
    topLevel.test(labels.at(-1) ?? '')
  );
}

/** Written-out or bracketed dots, as in `evil[.]example`, which people use to hide a host. */
const defangedDots = ['[.]', '(.)', '{.}', '[dot]', '(dot)'];

/**
 * Whether a word holds a link, an address or a host name anywhere in it: Markdown and brackets
 * split a word into pieces, each tested on its own, so `[text](https://…)` is caught too.
 */
function linkLike(word: string): boolean {
  // Full-width and ideographic dots fold to `.`, so `evil。example` reads as the host it is.
  const lower = word
    .normalize('NFKC')
    .replace(/\u3002/gu, '.')
    .toLowerCase();
  if (lower.includes('://') || lower.includes('www.') || lower.includes('@')) return true;
  if (defangedDots.some((dot) => lower.includes(dot))) return true;
  return lower.split(/[[\](){}<>‹›"'!`]+/u).some((piece) => piece !== '' && pieceLinkLike(piece));
}

/**
 * Characters that show nothing: format characters such as those with no width, the soft hyphen
 * and the ones that reorder the text around them, then the joiners, variation selectors and
 * blank that are not format characters. Any could split a host name so that no word of it reads
 * as one.
 */
const unseen = /[\p{Cf}\p{Variation_Selector}\u2800]|\u034F/gu;

/**
 * Links, addresses, e-mail addresses and host names out of a note, angle brackets too, then
 * capped.
 */
export function plainNote(note: string): string | null {
  const plain = normalizeWhitespace(
    note
      .replace(unseen, '')
      .split(/\s+/u)
      .filter((word) => !linkLike(word))
      .join(' ')
      .replace(/[<>]/g, ' '),
  );
  if (plain === '') return null;
  return plain.length > maxNoteLength ? `${plain.slice(0, maxNoteLength - 1).trimEnd()}…` : plain;
}

const unchecked = (key: string, reason: CheckReason, note: string | null = null): CheckedItem => ({
  key,
  status: 'could_not_check',
  quotes: [],
  note,
  reason,
});

const noteOf = ({ note }: CheckAnswer): string | null =>
  note === undefined ? null : plainNote(note);

type QuoteCheck =
  | { readonly ok: true; readonly quote: CheckQuote; readonly page: ReadPage }
  | { readonly ok: false; readonly reason: CheckReason };

/** One quote, checked on its own against the page it names. */
function checkQuote(
  item: CheckItem,
  answered: CheckQuote,
  pages: ReadonlyMap<string, ReadPage>,
): QuoteCheck {
  const { url } = answered;
  if (!item.urls.includes(url)) return { ok: false, reason: 'url_not_cited' };
  const page = pages.get(url);
  if (page === undefined) return { ok: false, reason: 'page_not_read' };
  const quote = normalizeWhitespace(answered.quote);
  if (quote.length < minQuoteLength || quote.length > maxQuoteLength) {
    return { ok: false, reason: 'quote_length' };
  }
  // An excerpt's gap line stands for text left out, so a quote counts only within one run.
  const runs = page.excerpt === true ? excerptRuns(page.text) : [page.text];
  if (!runs.some((run) => normalizeWhitespace(run).includes(quote))) {
    return { ok: false, reason: 'quote_not_on_page' };
  }
  if (echoesAddress(quote, page, item.values)) return { ok: false, reason: 'echoes_address' };
  return { ok: true, quote: { quote, url }, page };
}

function verifyOne(
  item: CheckItem,
  answer: CheckAnswer | undefined,
  pages: ReadonlyMap<string, ReadPage>,
): CheckedItem {
  if (item.urls.length === 0) return unchecked(item.key, 'no_source_cited');
  if (!item.urls.some((cited) => pages.has(cited))) return unchecked(item.key, 'no_page_read');
  if (answer === undefined) return unchecked(item.key, 'not_answered');
  if (answer.status === 'could_not_check') {
    return unchecked(item.key, 'model_could_not_check', noteOf(answer));
  }
  const answered = answer.quotes ?? [];
  if (answered.length === 0 || answered.length > maxQuotes) {
    return unchecked(item.key, 'quote_count');
  }
  const checked: { quote: CheckQuote; page: ReadPage }[] = [];
  for (const quote of answered) {
    const result = checkQuote(item, quote, pages);
    if (!result.ok) return unchecked(item.key, result.reason);
    checked.push(result);
  }
  const quotes = checked.map(({ quote }) => quote);
  if (answer.status === 'matches') {
    if (checked.some(({ page }) => page.cut)) return unchecked(item.key, 'page_cut');
    if (!item.values.every((value) => quotes.some(({ quote }) => statesValue(value, quote)))) {
      return unchecked(item.key, 'value_not_in_quote');
    }
    return { key: item.key, status: 'matches', quotes, note: null, reason: null };
  }
  return { key: item.key, status: 'differs', quotes, note: noteOf(answer), reason: null };
}

/**
 * What a report says about each item (ADR-0027), checked in code. A match or a difference rests on
 * one to `maxQuotes` quotes, and every one must count: after whitespace is normalized, a substring
 * of the exact text sent for a URL the item itself cites, within one run of an excerpt, within the
 * length limits and echoing no address of its page's redirect chain. A match also needs every
 * value the item states in at least one of its quotes, and no quote from a page that was cut. An
 * item that cites no official page, whose pages were all unread, or that the model left out,
 * answered twice or failed on is could not be checked, with the model's own reason when it gave
 * one; keys of no item are dropped.
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
