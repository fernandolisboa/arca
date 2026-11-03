import fc from 'fast-check';
import {
  type CalendarDate,
  type Duration,
  calendarDate,
  daysInMonth,
  parseDuration,
} from '../src/index.js';

export function calendarDates({
  minYear = 1,
  maxYear = 9999,
}: { minYear?: number; maxYear?: number } = {}): fc.Arbitrary<CalendarDate> {
  return fc
    .record({
      year: fc.integer({ min: minYear, max: maxYear }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 31 }),
    })
    .map(({ year, month, day }) =>
      calendarDate({ year, month, day: Math.min(day, daysInMonth(year, month)) }),
    );
}

export function durations(): fc.Arbitrary<Duration> {
  return fc
    .record({
      years: fc.integer({ min: 0, max: 50 }),
      months: fc.integer({ min: 0, max: 30 }),
      days: fc.integer({ min: 0, max: 400 }),
    })
    .filter(({ years, months, days }) => years + months + days > 0)
    .map(({ years, months, days }) =>
      parseDuration(
        `P${years > 0 ? `${String(years)}Y` : ''}${months > 0 ? `${String(months)}M` : ''}${days > 0 ? `${String(days)}D` : ''}`,
      ),
    );
}
