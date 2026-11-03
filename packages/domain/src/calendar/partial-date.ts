import { z } from 'zod';
import {
  type Compare,
  type ComparisonOperator,
  type Range,
  type Truth,
  compareRanges,
} from '../logic/truth.js';
import {
  type CalendarDate,
  addDuration,
  calendarDate,
  calendarDateSchema,
  compareDates,
  daysInMonth,
} from './calendar-date.js';
import type { Duration } from './duration.js';

const partialDatePattern = /^(\d{4})(?:-(\d{2}))?$/;

/**
 * A year, or a year and month, for records that are incomplete, such as an ancestor's birth.
 */
export const partialDateSchema = z
  .string()
  .regex(partialDatePattern)
  .refine(isPartialDate, { message: 'Not a partial date' })
  .brand<'PartialDate'>();

export type PartialDate = z.infer<typeof partialDateSchema>;

/** A full calendar date, or a partial one. */
export const dateValueSchema = z.union([calendarDateSchema, partialDateSchema]);

export type DateValue = CalendarDate | PartialDate;

export function isPartialDate(value: string): boolean {
  const match = partialDatePattern.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = match[2] === undefined ? 1 : Number(match[2]);
  return year >= 1 && month >= 1 && month <= 12;
}

export function parsePartialDate(value: string): PartialDate {
  return partialDateSchema.parse(value);
}

/** The earliest and latest calendar dates a value could be. A full date is a range of one day. */
export function dateRange(value: DateValue): Range<CalendarDate> {
  if (value.length === 10) {
    const date = value as CalendarDate;
    return { min: date, max: date };
  }
  const year = Number(value.slice(0, 4));
  if (value.length === 4) {
    return {
      min: calendarDate({ year, month: 1, day: 1 }),
      max: calendarDate({ year, month: 12, day: 31 }),
    };
  }
  const month = Number(value.slice(5, 7));
  return {
    min: calendarDate({ year, month, day: 1 }),
    max: calendarDate({ year, month, day: daysInMonth(year, month) }),
  };
}

const byDate: Compare<CalendarDate> = compareDates;

/** True or false only when every date the values could be gives the same answer. */
export function compareDateValues(
  left: DateValue,
  operator: ComparisonOperator,
  right: DateValue,
): Truth {
  return compareRanges(dateRange(left), operator, dateRange(right), byDate);
}

/**
 * Whether `start` plus `duration` is on or before `reference`, for a start date that may be
 * partial. Adding a duration never reorders dates, so the range's ends decide.
 */
export function elapsedSinceValue(
  start: DateValue,
  duration: Duration,
  reference: CalendarDate,
): Truth {
  const { min, max } = dateRange(start);
  if (compareDates(addDuration(max, duration), reference) <= 0) return true;
  if (compareDates(addDuration(min, duration), reference) > 0) return false;
  return 'unknown';
}
