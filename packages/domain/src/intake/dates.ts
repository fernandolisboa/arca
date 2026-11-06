/**
 * The dates a member's text states, at the precision it states them (spec 0008, R1 and R2). Only
 * real dates count: a month from 1 to 12, a day that fits it, and a year from 1800 to 2100, so a
 * bank branch or an account number shaped like a date is not one.
 */

export interface StatedDate {
  readonly year: number;
  readonly month?: number;
  readonly day?: number;
}

const months = [
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export const isYear = (digits: string): boolean =>
  /^[0-9]{4}$/.test(digits) && Number(digits) >= 1800 && Number(digits) <= 2100;

function realDate(year: string, month?: string, day?: string): StatedDate | undefined {
  if (!isYear(year)) return undefined;
  const y = Number(year);
  if (month === undefined) return { year: y };
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) return undefined;
  if (day === undefined) return { year: y, month: m };
  const d = Number(day);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Number.isInteger(d) && d >= 1 && d <= last ? { year: y, month: m, day: d } : undefined;
}

/** A run of digits and separators that is, as a whole, a numeric date in a usual shape. */
export function numericDate(run: string): StatedDate | undefined {
  const dayFirst = /^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{4})$/.exec(run);
  if (dayFirst) return realDate(dayFirst[3] ?? '', dayFirst[2], dayFirst[1]);
  const iso = /^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$/.exec(run);
  if (iso) return realDate(iso[1] ?? '', iso[2], iso[3]);
  const monthFirst = /^([0-9]{1,2})[/.-]([0-9]{4})$/.exec(run);
  if (monthFirst) return realDate(monthFirst[2] ?? '', monthFirst[1]);
  const yearFirst = /^([0-9]{4})[/-]([0-9]{1,2})$/.exec(run);
  if (yearFirst) return realDate(yearFirst[1] ?? '', yearFirst[2]);
  return undefined;
}

const fold = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');

/** Every date the text states: numeric shapes, "3 de março de 1950", "março de 1950", years. */
export function statedDates(text: string): StatedDate[] {
  const folded = fold(text);
  const found: StatedDate[] = [];
  const push = (date: StatedDate | undefined) => {
    if (date !== undefined) found.push(date);
  };
  for (const [run] of folded.matchAll(/(?<![0-9])[0-9][0-9/.-]*[0-9](?![0-9])/g)) {
    push(numericDate(run));
  }
  const monthName = months.join('|');
  const inWords = new RegExp(
    String.raw`(?:(?<![0-9])([0-9]{1,2})(?:º|o)?\s+de\s+)?(${monthName})\s+(?:de\s+)?([0-9]{4})(?![0-9])`,
    'gu',
  );
  for (const match of folded.matchAll(inWords)) {
    const month = String(months.indexOf(match[2] ?? '') + 1);
    push(realDate(match[3] ?? '', month, match[1]));
  }
  for (const [year] of folded.matchAll(/(?<![0-9])[0-9]{4}(?![0-9])/g)) {
    push(realDate(year));
  }
  return found;
}
