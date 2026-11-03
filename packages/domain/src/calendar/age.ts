import { z } from 'zod';
import { type CalendarDate, compareDates, dateParts, isLeapYear } from './calendar-date.js';

/**
 * When someone born on 29 February turns a year older in a common year. Jurisdictions differ, so a
 * route version that compares an age names its convention and cites its source (spec 0002, R2).
 */
export const leapDayBirthdaySchema = z.enum(['feb-28', 'march-1']);

export type LeapDayBirthday = z.infer<typeof leapDayBirthdaySchema>;

/** Whole years of age at `date`. */
export function ageYears(
  birthDate: CalendarDate,
  date: CalendarDate,
  leapDayBirthday: LeapDayBirthday,
): number {
  if (compareDates(birthDate, date) > 0) throw new RangeError('Born after the date');
  const birth = dateParts(birthDate);
  const at = dateParts(date);
  const birthday = birthdayIn(at.year, birth.month, birth.day, leapDayBirthday);
  const beforeBirthday =
    at.month < birthday.month || (at.month === birthday.month && at.day < birthday.day);
  return at.year - birth.year - (beforeBirthday ? 1 : 0);
}

function birthdayIn(
  year: number,
  month: number,
  day: number,
  leapDayBirthday: LeapDayBirthday,
): { month: number; day: number } {
  if (month !== 2 || day !== 29 || isLeapYear(year)) return { month, day };
  return leapDayBirthday === 'feb-28' ? { month: 2, day: 28 } : { month: 3, day: 1 };
}
