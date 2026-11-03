import { z } from 'zod';
import { type Duration, durationParts } from './duration.js';

const calendarDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

const minYear = 1;
const maxYear = 9999;

export const firstDate = '0001-01-01' as CalendarDate;
export const lastDate = '9999-12-31' as CalendarDate;

/**
 * An ISO 8601 calendar date, `YYYY-MM-DD`, with no time or time zone, from year 1 to 9999. In this
 * form, string order is date order.
 */
export const calendarDateSchema = z
  .string()
  .regex(calendarDatePattern)
  .refine(isCalendarDate, { message: 'Not a calendar date' })
  .brand<'CalendarDate'>();

export type CalendarDate = z.infer<typeof calendarDateSchema>;

export interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export function isCalendarDate(value: string): boolean {
  const match = calendarDatePattern.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return isValidParts({ year, month, day });
}

export function parseCalendarDate(value: string): CalendarDate {
  return calendarDateSchema.parse(value);
}

export function dateParts(date: CalendarDate): DateParts {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

export function calendarDate(parts: DateParts): CalendarDate {
  if (!isValidParts(parts)) throw new RangeError('Not a calendar date');
  const year = String(parts.year).padStart(4, '0');
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${year}-${month}-${day}` as CalendarDate;
}

export function compareDates(left: CalendarDate, right: CalendarDate): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Adds years, then months, clamping to the month's last day, then days, as
 * `Temporal.PlainDate.add` does.
 */
export function addDuration(date: CalendarDate, duration: Duration): CalendarDate {
  return inRange(tryAddDuration(date, duration));
}

/** Adds whole months (negative to go back), clamping to the month's last day. */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  return inRange(tryAddMonths(date, months));
}

/** Adds days (negative to go back). */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  return inRange(tryAddDays(date, days));
}

/** Like `addDuration`, but undefined when the result is outside years 1 to 9999. */
export function tryAddDuration(date: CalendarDate, duration: Duration): CalendarDate | undefined {
  const { years, months, days } = durationParts(duration);
  const shifted = tryAddMonths(date, years * 12 + months);
  return shifted === undefined ? undefined : tryAddDays(shifted, days);
}

export function tryAddMonths(date: CalendarDate, months: number): CalendarDate | undefined {
  const { year, month, day } = dateParts(date);
  const monthIndex = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = monthIndex - targetYear * 12 + 1;
  if (!Number.isInteger(monthIndex) || targetYear < minYear || targetYear > maxYear)
    return undefined;
  return calendarDate({
    year: targetYear,
    month: targetMonth,
    day: Math.min(day, daysInMonth(targetYear, targetMonth)),
  });
}

export function tryAddDays(date: CalendarDate, days: number): CalendarDate | undefined {
  const dayNumber = toDayNumber(dateParts(date)) + days;
  if (!Number.isInteger(dayNumber) || dayNumber < firstDayNumber || dayNumber > lastDayNumber) {
    return undefined;
  }
  return fromDayNumber(dayNumber);
}

/**
 * Whole months from `from` to `to`: the largest `n` with `addMonths(from, n) <= to`. So "at least
 * PnM since D" and `wholeMonthsBetween(D, reference) >= n` always agree.
 */
export function wholeMonthsBetween(from: CalendarDate, to: CalendarDate): number {
  if (compareDates(from, to) > 0) throw new RangeError('`from` is after `to`');
  const start = dateParts(from);
  const end = dateParts(to);
  const months = (end.year - start.year) * 12 + (end.month - start.month);
  return compareDates(addMonths(from, months), to) > 0 ? months - 1 : months;
}

/** Whole years from `from` to `to`: the largest `n` with `addMonths(from, 12n) <= to`. */
export function wholeYearsBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.floor(wholeMonthsBetween(from, to) / 12);
}

/**
 * True when `start` plus `duration` is on or before `reference`. Durations are compared only
 * anchored to a date, never with each other.
 */
export function elapsedSince(
  start: CalendarDate,
  duration: Duration,
  reference: CalendarDate,
): boolean {
  const end = tryAddDuration(start, duration);
  return end !== undefined && compareDates(end, reference) <= 0;
}

function inRange(date: CalendarDate | undefined): CalendarDate {
  if (date === undefined) throw new RangeError('Date outside years 1 to 9999');
  return date;
}

function isValidParts({ year, month, day }: DateParts): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    year >= minYear &&
    year <= maxYear &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

// Days since 0000-03-01 in the proleptic Gregorian calendar (H. Hinnant's days_from_civil, shifted
// so the year starts in March and the leap day falls last).
function toDayNumber({ year, month, day }: DateParts): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra;
}

function fromDayNumber(dayNumber: number): CalendarDate {
  const era = Math.floor(dayNumber / 146097);
  const dayOfEra = dayNumber - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return calendarDate({ year, month, day });
}

const firstDayNumber = toDayNumber({ year: minYear, month: 1, day: 1 });
const lastDayNumber = toDayNumber({ year: maxYear, month: 12, day: 31 });
