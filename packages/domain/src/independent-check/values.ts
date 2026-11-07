import type { CalendarDate } from '../calendar/calendar-date.js';

/**
 * A value an item states, which a quote must contain for a match to count (ADR-0027): a number
 * (an amount in its currency's units, an age, a count, a part of a duration) or a date. The model
 * picks the passage; code compares the value.
 */
export type CheckValue =
  | { readonly kind: 'number'; readonly value: string }
  | { readonly kind: 'date'; readonly value: CalendarDate };

/** A non-negative decimal written with digits and at most one dot, without needless zeros. */
export function canonicalNumber(decimal: string): string {
  const [whole = '', fraction = ''] = decimal.split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  const decimals = fraction.replace(/0+$/, '');
  return decimals === '' ? integer : `${integer}.${decimals}`;
}

/** Group separators a number may be written with besides the dot and the comma. */
const spaceLike = /[\s\u00a0\u2009\u202f']/u;
const numberToken = /\d+(?:[.,\s\u00a0\u2009\u202f']\d+)*/gu;

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
 * Every number a text may state, each read with a dot, a comma or no decimal mark, so
 * `1.800.000`, `1,800,000`, `1 800 000` and `920,00` all read as the numbers they write. A run
 * with spaces that reads as no one number, such as `18 21`, is read piece by piece; one that does,
 * such as `1 800`, is never also read as `800`. Reading too many numbers lets more quotes through
 * the value check, so the readings stay strict: three-digit groups and one decimal mark.
 */
export function numbersIn(text: string): ReadonlySet<string> {
  const found = new Set<string>();
  for (const [token] of text.matchAll(numberToken)) {
    const whole = readings(token);
    const pieces =
      whole.length > 0 ? [] : token.split(/[\s\u00a0\u2009\u202f]+/u).flatMap(readings);
    for (const read of [...whole, ...pieces]) found.add(read);
  }
  return found;
}

/** Locales whose month names a dated passage may use: those of the countries in the catalog. */
const monthLocales = [
  'en',
  'pt',
  'es',
  'it',
  'fr',
  'de',
  'pl',
  'cs',
  'da',
  'is',
  'et',
  'lv',
  'lt',
  'ja',
  'he',
] as const;

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

const numericDate = /(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/gu;

/** Whether the text writes the date with numbers only, day, month and year in a usual order. */
function writesNumericDate(text: string, year: string, month: string, day: string): boolean {
  for (const [, first = '', second = '', third = ''] of text.matchAll(numericDate)) {
    const [a, b, c] = [first, second, third].map(canonicalNumber);
    if (
      (c === year && ((a === day && b === month) || (a === month && b === day))) ||
      (a === year && b === month && c === day)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a text states the value: a number among the numbers it writes; a date in ISO form, with
 * numbers in a usual order, or by its year, its day and its month's name in one of the catalog's
 * languages.
 */
export function statesValue(value: CheckValue, text: string): boolean {
  const numbers = numbersIn(text);
  if (value.kind === 'number') return numbers.has(value.value);
  if (text.includes(value.value)) return true;
  const [year = '', month = '', day = ''] = value.value.split('-').map(canonicalNumber);
  if (writesNumericDate(text, year, month, day)) return true;
  if (!numbers.has(year) || !numbers.has(day)) return false;
  const lower = text.normalize('NFC').toLowerCase();
  return monthNames(Number(month)).some((name) =>
    new RegExp(`(?<!\\p{L})${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`, 'u').test(
      lower,
    ),
  );
}
