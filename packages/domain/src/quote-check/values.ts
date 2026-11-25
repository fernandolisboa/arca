import type { CalendarDate } from '../calendar/calendar-date.js';
import { writesAnniversary, writesNumberInWords } from './number-words.js';

/**
 * A value an item states, which a quote must contain for a match to count (ADR-0027): a number
 * (an amount in its currency's units, an age, a count, a part of a duration) or a date. The model
 * picks the passage; code compares the value.
 */
export type CheckValue =
  | {
      readonly kind: 'number';
      readonly value: string;
      /** For a count of months that makes whole years (never 0 or 1): those years, as law text may write them. */
      readonly wholeYears?: string;
    }
  | { readonly kind: 'date'; readonly value: CalendarDate };

/** A non-negative decimal written with digits and at most one dot, without needless zeros. */
export function canonicalNumber(decimal: string): string {
  const [whole = '', fraction = ''] = decimal.split('.');
  // Index scans rather than patterns, so a long run of zeros never makes a pattern backtrack.
  let start = 0;
  while (start < whole.length - 1 && whole[start] === '0') start += 1;
  let end = fraction.length;
  while (end > 0 && fraction[end - 1] === '0') end -= 1;
  const integer = whole.slice(start);
  const decimals = fraction.slice(0, end);
  return decimals === '' ? integer : `${integer}.${decimals}`;
}

/** Group separators a number may be written with besides the dot and the comma. */
const spaceLike = /[\s\u00a0\u2009\u202f']/u;
const numberToken = /\d+(?:[.,\s\u00a0\u2009\u202f']\d+)*/gu;
const spaceRun = /[\s\u00a0\u2009\u202f]+/u;

const digit = (char: string | undefined) => char !== undefined && /[0-9\uff10-\uff19]/u.test(char);
const separator = (char: string | undefined) =>
  char !== undefined && /[.,\s\u00a0\u2009\u202f'\uff0c\uff0e]/u.test(char);

/**
 * The bounds of `text.slice(start, end)` widened to the whole figures its ends cut into, group
 * separators and decimal marks included, so "500" cut from "1.500" or "5" from "2,5" reads whole.
 */
export function figureBounds(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let from = start;
  let to = end;
  for (;;) {
    const before = text[from - 1];
    const at = text[from];
    if (digit(before) && (digit(at) || (separator(at) && digit(text[from + 1])))) from -= 1;
    else if (separator(before) && digit(text[from - 2]) && digit(at)) from -= 1;
    else break;
  }
  for (;;) {
    const at = text[to];
    const before = text[to - 1];
    if (digit(at) && (digit(before) || (separator(before) && digit(text[to - 2])))) to += 1;
    else if (separator(at) && digit(before) && digit(text[to + 1])) to += 1;
    else break;
  }
  return { start: from, end: to };
}

/**
 * The number a token stands for when `decimal` is its decimal mark, or undefined when the token
 * cannot be read that way: the decimal mark comes once and last, and every group before it after
 * the first has three digits.
 */
function readToken(token: string, decimal: '.' | ',' | undefined): string | undefined {
  const parts = token.split(/([.,\s\u00a0\u2009\u202f'])/u);
  const digits = parts.filter((_, index) => index % 2 === 0);
  const separators = parts.filter((_, index) => index % 2 === 1);
  let fraction = '';
  if (decimal !== undefined) {
    if (separators.at(-1) !== decimal || separators.slice(0, -1).includes(decimal)) {
      return undefined;
    }
    fraction = digits.pop() ?? '';
    separators.pop();
  }
  const [first = '', ...groups] = digits;
  if (groups.some((group) => group.length !== 3)) return undefined;
  if (separators.some((separator) => separator === decimal)) return undefined;
  // One group separator per number, as written; mixing them is two numbers, not one.
  if (
    new Set(separators.map((separator) => (spaceLike.test(separator) ? ' ' : separator))).size > 1
  )
    return undefined;
  const whole = `${first}${groups.join('')}`;
  return canonicalNumber(fraction === '' ? whole : `${whole}.${fraction}`);
}

const readings = (token: string) =>
  (['.', ',', undefined] as const)
    .map((decimal) => readToken(token, decimal))
    .filter((read) => read !== undefined);

/**
 * Full-width digits, comma and full stop (as Japanese text writes figures, `１，５００`) as plain
 * ones, one character for one, so every reading and every guard sees the same figure.
 */
function halfWidthDigits(text: string): string {
  return text.replace(/[\uff0c\uff0e\uff10-\uff19]/gu, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  );
}

/**
 * Every number a text may state, each read with a dot, a comma or no decimal mark, so
 * `1.800.000`, `1,800,000`, `1 800 000` and `920,00` all read as the numbers they write. A run
 * with spaces that reads as no one number, such as `18 21`, is read piece by piece; one that does,
 * such as `1 800`, is never also read as `800`. Reading too many numbers lets more quotes through
 * the value check, so the readings stay strict: three-digit groups and one decimal mark.
 */
export function numbersIn(text: string): ReadonlySet<string> {
  const found = new Set<string>();
  for (const [token] of halfWidthDigits(text).matchAll(numberToken)) {
    const whole = readings(token);
    const pieces = whole.length > 0 ? [] : token.split(spaceRun).flatMap(readings);
    for (const read of [...whole, ...pieces]) found.add(read);
  }
  return found;
}

/** A percent sign, `%` or its full-width or small form, right after a figure or after one space. */
const percentSign = /^[\s\u00a0\u2009\u202f]?[%\uff05\ufe6a]/u;

/** A canonical decimal divided by one hundred by moving its decimal mark, so nothing rounds it. */
function dividedByHundred(decimal: string): string {
  const [whole = '', fraction = ''] = decimal.split('.');
  const padded = whole.padStart(3, '0');
  return canonicalNumber(`${padded.slice(0, -2)}.${padded.slice(-2)}${fraction}`);
}

/**
 * Every share a text writes as a percentage, as the number it stands for: "50 %" reads 0.5 and
 * "34,75 %" reads 0.3475, since a rule multiplies by the factor where the law writes the
 * percentage. Only the figure the sign follows is read, with the readings `numbersIn` gives it.
 */
export function percentagesIn(text: string): ReadonlySet<string> {
  const found = new Set<string>();
  // Each figure is found once and the sign looked for after it, so a long text stays linear.
  for (const match of halfWidthDigits(text).matchAll(numberToken)) {
    const [token] = match;
    const end = match.index + token.length;
    if (!percentSign.test(text.slice(end, end + 2))) continue;
    const whole = readings(token);
    const lastPiece = whole.length > 0 ? [] : readings(token.split(spaceRun).at(-1) ?? '');
    for (const read of [...whole, ...lastPiece]) found.add(dividedByHundred(read));
  }
  return found;
}

/** A line break of any kind: a quote reads each as one space. */
const lineBreak = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/u;

/**
 * A text with the digits of two lines, or of two columns of one line, kept apart, as a bar keeps
 * the cells of a table row: a line that starts with a digit after one that ends with a digit opens
 * with a bar, and a tab or a run of spaces between two digits becomes one. A quote takes any
 * whitespace as one space and `numbersIn` takes a space between digits as a group separator, so
 * "Article 1" above "600 EUR" would otherwise state 1,600. Every text a quote is checked against
 * goes through this first.
 */
export function digitsApart(text: string): string {
  let afterDigit = false;
  return text
    .split(lineBreak)
    .map((line) => {
      const columns = line.replace(
        /(?<=[0-9\uff10-\uff19])(?:\s{2,}|\t|\u3000)(?=[0-9\uff10-\uff19])/gu,
        ' | ',
      );
      const words = columns.trim();
      if (words === '') return columns;
      const barred = afterDigit && /^[0-9\uff10-\uff19]/u.test(words);
      afterDigit = /[0-9\uff10-\uff19]$/u.test(words);
      return barred ? `| ${columns}` : columns;
    })
    .join('\n');
}

/**
 * Languages whose month names a dated passage may use: a wide set rather than the catalog's
 * countries, so a country added as data needs no change here. A name in another language fails
 * closed: the item is could not be checked.
 */
const monthLocales = Intl.DateTimeFormat.supportedLocalesOf([
  'ar',
  'bg',
  'ca',
  'cs',
  'cy',
  'da',
  'de',
  'el',
  'en',
  'es',
  'et',
  'eu',
  'fi',
  'fr',
  'ga',
  'gl',
  'he',
  'hr',
  'hu',
  'id',
  'is',
  'it',
  'ja',
  'ko',
  'lt',
  'lv',
  'mt',
  'nb',
  'nl',
  'nn',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sq',
  'sr',
  'sv',
  'th',
  'tr',
  'uk',
  'vi',
  'zh',
]);

/** Every way the month may be named, standing alone or inside a date, in lower case. */
function monthNames(month: number): readonly string[] {
  const day = new Date(Date.UTC(2000, month - 1, 1));
  return [
    ...new Set(
      monthLocales.flatMap((locale) => [
        new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(day),
        ...new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' })
          .formatToParts(day)
          .filter(({ type }) => type === 'month')
          .map(({ value }) => value),
      ]),
    ),
  ]
    .map((name) => name.normalize('NFC').toLowerCase())
    .filter((name) => /\p{L}/u.test(name));
}

const isLetter = (char: string) => /\p{L}/u.test(char);
const isDigit = (char: string) => char >= '0' && char <= '9';
/** Hebrew writes "in" or "to" as one letter joined to the month: בינואר, לינואר. */
const joinedPrefixes = new Set(['ב', 'ל', 'ה']);
/** How far, in characters, the day or the year may stand from the month's name. */
const nearby = 6;

/** Where the name stands in the text as a word of its own; `12月` holds `2月` but does not state it. */
function namePositions(text: string, name: string): number[] {
  const positions: number[] = [];
  for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + 1)) {
    const before = text.charAt(at - 1);
    const after = text.charAt(at + name.length);
    const startsWithDigit = isDigit(name.charAt(0));
    const openStart = startsWithDigit
      ? !isDigit(before)
      : !isLetter(before) || (joinedPrefixes.has(before) && !isLetter(text.charAt(at - 2)));
    const endsWithLetter = isLetter(name.charAt(name.length - 1));
    if (openStart && !(endsWithLetter && isLetter(after))) positions.push(at);
  }
  return positions;
}

/**
 * Whether the text names the month beside its day or its year, so "may" the verb or a month
 * mentioned far from the numbers does not state the date.
 */
function namesMonth(text: string, month: number, day: string, year: string): boolean {
  const numbers = [...text.matchAll(/\d+/gu)].map((match) => ({
    value: canonicalNumber(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));
  return monthNames(month).some((name) =>
    namePositions(text, name).some((at) =>
      numbers.some(
        ({ value, start, end }) =>
          (value === day || value === year) &&
          start - (at + name.length) <= nearby &&
          at - end <= nearby,
      ),
    ),
  );
}

const numericDate = /(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/gu;

/**
 * Whether the text writes the date with numbers only: year first, or day and month in either order
 * when only one order makes a date, since `05.03.2026` reads as March or May by country.
 */
function writesNumericDate(text: string, year: string, month: string, day: string): boolean {
  const ambiguous = day !== month && Number(day) <= 12;
  for (const [, first = '', second = '', third = ''] of text.matchAll(numericDate)) {
    const [a, b, c] = [first, second, third].map(canonicalNumber);
    if (a === year && b === month && c === day) return true;
    if (c === year && !ambiguous && ((a === day && b === month) || (a === month && b === day))) {
      return true;
    }
  }
  return false;
}

const yearWords = String.raw`(?:years?|anni|anno|anos?|años?)(?!\p{L})`;
/** A whole figure right before a word for years: never the tail of 1.5, 5-3 or 2,5. */
const figureBeforeYears = new RegExp(
  String.raw`(?<![\d.,-])(\d+(?:[.,]\d+)*)\s*(?:${yearWords}|年)`,
  'giu',
);
/** One word, or words joined by hyphens, right before a word for years: "five", "twenty-five". */
const wordBeforeYears = new RegExp(
  String.raw`(?<![\p{L}\p{N}-])(\p{L}+(?:-\p{L}+)*)\s+${yearWords}`,
  'giu',
);
/** A whole run of kanji numerals right before 年, not after 第. */
const kanjiBeforeYears = /(?<![〇一二三四五六七八九十百千第])([〇一二三四五六七八九十百千]+年)/gu;

/**
 * Whether a text states a number of years: the number right before a word for years, as a figure
 * or in words ("5 years", "cinque anni", 五年以上), so "article 5", "5 days" or a 五 earlier in the
 * clause does not. Full-width digits read as plain ones.
 */
export function statesYears(
  text: string,
  years: string,
  languages: readonly string[] = [],
): boolean {
  const plain = text.normalize('NFKC');
  return (
    [...plain.matchAll(figureBeforeYears)].some(([, figure = '']) =>
      numbersIn(figure).has(years),
    ) ||
    [...plain.matchAll(wordBeforeYears)].some(([, words = '']) =>
      writesNumberInWords(words, years, languages),
    ) ||
    [...plain.matchAll(kanjiBeforeYears)].some(([, run = '']) =>
      writesNumberInWords(run, years, languages),
    )
  );
}

/**
 * Whether a text states the value: a number among the numbers it writes, as a figure or as a
 * percentage of one, or a whole number written in words of one of `languages`; a date in ISO form,
 * in numbers that read one way only, or by its year, its day and its month's name beside them.
 */
export function statesValue(
  value: CheckValue,
  text: string,
  languages: readonly string[] = [],
): boolean {
  const numbers = numbersIn(text);
  if (value.kind === 'number') {
    return (
      numbers.has(value.value) ||
      percentagesIn(text).has(value.value) ||
      writesNumberInWords(text, value.value, languages) ||
      writesAnniversary(text, value.value, languages) ||
      (value.wholeYears !== undefined && statesYears(text, value.wholeYears, languages))
    );
  }
  if (text.includes(value.value)) return true;
  const [year = '', month = '', day = ''] = value.value.split('-').map(canonicalNumber);
  if (writesNumericDate(text, year, month, day)) return true;
  if (!numbers.has(year) || !numbers.has(day)) return false;
  return namesMonth(text.normalize('NFC').toLowerCase(), Number(month), day, year);
}
