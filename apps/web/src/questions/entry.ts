/**
 * How the guided questions' answers are typed in (spec 0007, R4): dates in parts, amounts with a
 * decimal comma, shares as percentages. Only text is moved around here; the API turns amounts
 * into minor units and checks every answer against the storage schemas.
 */

export interface DateParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
}

export const noDate: DateParts = { year: '', month: '', day: '' };

export function dateParts(value: unknown): DateParts {
  if (typeof value !== 'string') return noDate;
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value);
  return match === null
    ? noDate
    : { year: match[1] ?? '', month: match[2] ?? '', day: match[3] ?? '' };
}

export function joinDate({ year, month, day }: DateParts): string | undefined {
  if (!/^\d{4}$/.test(year)) return undefined;
  if (month === '') return year;
  return day === '' ? `${year}-${month}` : `${year}-${month}-${day}`;
}

export const amountText = (amount: string) => amount.replace('.', ',');

const groupedAmount = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;

/**
 * `1.234,50` or `1234,50` back as a decimal string, `1234.50`. A point is a thousands separator
 * only between groups of three, so `1500.50` typed on a keypad with a point stays `1500.50`; the
 * API refuses anything that is not a decimal.
 */
export function amountValue(text: string): string {
  const typed = text.replace(/\s/g, '');
  if (groupedAmount.test(typed)) return typed.replace(/\./g, '').replace(',', '.');
  return typed.includes('.') ? typed : typed.replace(',', '.');
}

const percentPattern = /^(\d{1,3})(?:[.,](\d{1,4}))?$/;

/** A share from a percentage, by moving the decimal point: `50` is `0.5`, `100` is `1`. */
export function shareFromPercent(text: string): string | undefined {
  const match = percentPattern.exec(text.trim());
  if (match === null) return undefined;
  const fraction = match[2] ?? '';
  const digits = `${match[1] ?? ''}${fraction}`.padStart(fraction.length + 3, '0');
  const point = digits.length - fraction.length - 2;
  return trimDecimal(`${digits.slice(0, point)}.${digits.slice(point)}`);
}

/** A share as a percentage: `0.500000` is `50`, `0.3333` is `33,33`. */
export function percentFromShare(share: string): string {
  const [whole = '0', fraction = ''] = share.split('.');
  const padded = fraction.padEnd(2, '0');
  return amountText(trimDecimal(`${whole}${padded.slice(0, 2)}.${padded.slice(2)}`));
}

function trimDecimal(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  const decimals = fraction.replace(/0+$/, '');
  return decimals === '' ? integer : `${integer}.${decimals}`;
}
