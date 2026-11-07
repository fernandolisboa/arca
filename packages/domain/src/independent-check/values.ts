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

/**
 * Every number a text may state, each read with a dot, a comma or no decimal mark, and each part
 * between spaces read on its own too, so `1.800.000`, `1,800,000`, `1 800 000` and `920,00` all
 * read as the numbers they write. Reading too many numbers only lets more quotes through the value
 * check, never fewer, so the readings stay strict: three-digit groups and one decimal mark.
 */
export function numbersIn(text: string): ReadonlySet<string> {
  const found = new Set<string>();
  for (const [token] of text.matchAll(numberToken)) {
    const pieces = [token, ...token.split(/[\s\u00a0\u2009\u202f]+/u)];
    for (const piece of new Set(pieces)) {
      for (const decimal of ['.', ',', undefined] as const) {
        const read = readToken(piece, decimal);
        if (read !== undefined) found.add(read);
      }
    }
  }
  return found;
}

/**
 * Whether a text states the value: a number among the numbers it writes; a date as written in ISO
 * form, or by its year and its day of the month, since month names differ in every language.
 */
export function statesValue(value: CheckValue, text: string): boolean {
  const numbers = numbersIn(text);
  if (value.kind === 'number') return numbers.has(value.value);
  if (text.includes(value.value)) return true;
  const [year = '', , day = ''] = value.value.split('-');
  return numbers.has(year) && numbers.has(canonicalNumber(day));
}
