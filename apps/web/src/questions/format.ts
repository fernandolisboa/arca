/** A stored date, full or partial, as people read it: `1985-04` is "abril de 1985". */
export function formatDateValue(value: string, locale: string): string {
  const [year = '', month, day] = value.split('-');
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month ?? '1') - 1, Number(day ?? '1'));
  const options: Intl.DateTimeFormatOptions =
    day !== undefined
      ? { day: 'numeric', month: 'long', year: 'numeric' }
      : month !== undefined
        ? { month: 'long', year: 'numeric' }
        : { year: 'numeric' };
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date);
}

/** A decimal amount in the currency's units, formatted exactly, never through a float. */
export function formatAmount(
  { amount, currency }: { readonly amount: string; readonly currency: string },
  locale: string,
): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amount as Intl.StringNumericLiteral,
  );
}

/** An amount in the currency's minor units, as a decimal string, never through a float. */
export function majorUnits(amount: number, digits: number): string {
  if (digits === 0) return String(amount);
  const sign = amount < 0 ? '-' : '';
  const padded = String(Math.abs(amount)).padStart(digits + 1, '0');
  return `${sign}${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}
