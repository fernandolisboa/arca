import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type CalendarDate,
  addDays,
  addDuration,
  addMonths,
  calendarDateSchema,
  compareDates,
  dateParts,
  durationUnits,
  elapsedSince,
  isCalendarDate,
  parseCalendarDate,
  parseDuration,
  wholeMonthsBetween,
  wholeYearsBetween,
} from '../../src/index.js';
import { calendarDates, durations } from '../arbitraries.js';

const date = parseCalendarDate;
const duration = parseDuration;

function utcDayNumber(value: CalendarDate): number {
  const { year, month, day } = dateParts(value);
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  return Math.round(utc.getTime() / 86_400_000);
}

describe('CalendarDate', () => {
  it.each(['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31', '2026-11-03'])(
    'accepts %s',
    (value) => {
      expect(isCalendarDate(value)).toBe(true);
      expect(calendarDateSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each([
    '2023-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '0000-01-01',
    '2026-1-01',
    '2026-11-03T00:00:00Z',
    '20261103',
    ' 2026-11-03',
  ])('rejects %s', (value) => {
    expect(isCalendarDate(value)).toBe(false);
    expect(calendarDateSchema.safeParse(value).success).toBe(false);
  });

  it('orders as strings order', () => {
    fc.assert(
      fc.property(calendarDates(), calendarDates(), (left, right) => {
        expect(Math.sign(compareDates(left, right))).toBe(
          Math.sign(utcDayNumber(left) - utcDayNumber(right)),
        );
      }),
    );
  });
});

describe('addDuration', () => {
  it.each([
    ['2024-01-31', 'P1M', '2024-02-29'],
    ['2023-01-31', 'P1M', '2023-02-28'],
    ['2024-02-29', 'P1Y', '2025-02-28'],
    ['2024-02-29', 'P4Y', '2028-02-29'],
    ['2024-03-31', 'P1M', '2024-04-30'],
    ['2024-01-31', 'P1M1D', '2024-03-01'],
    ['2023-12-31', 'P1Y2M', '2025-02-28'],
    ['2026-11-03', 'P30D', '2026-12-03'],
    ['2026-11-03', 'P18M', '2028-05-03'],
  ])('%s + %s = %s', (start, added, expected) => {
    expect(addDuration(date(start), duration(added))).toBe(expected);
  });

  it('adds days as the UTC calendar does', () => {
    fc.assert(
      fc.property(
        calendarDates({ minYear: 2, maxYear: 9998 }),
        fc.integer({ min: -365, max: 365 }),
        (start, days) => {
          expect(utcDayNumber(addDays(start, days)) - utcDayNumber(start)).toBe(days);
        },
      ),
    );
  });

  it('clamps to the last day of the month and never overflows into the next', () => {
    fc.assert(
      fc.property(
        calendarDates({ maxYear: 9000 }),
        fc.integer({ min: 0, max: 600 }),
        (start, months) => {
          const result = dateParts(addMonths(start, months));
          const { year, month, day } = dateParts(start);
          const monthIndex = year * 12 + month - 1 + months;
          expect(result.year * 12 + result.month - 1).toBe(monthIndex);
          expect(result.day).toBeLessThanOrEqual(day);
        },
      ),
    );
  });

  it('never reorders dates', () => {
    fc.assert(
      fc.property(
        calendarDates({ maxYear: 9000 }),
        calendarDates({ maxYear: 9000 }),
        durations(),
        (a, b, added) => {
          if (compareDates(a, b) <= 0) {
            expect(compareDates(addDuration(a, added), addDuration(b, added))).toBeLessThanOrEqual(
              0,
            );
          }
        },
      ),
    );
  });

  it('rejects a result past year 9999', () => {
    expect(() => addDuration(date('9999-06-01'), duration('P1Y'))).toThrow(RangeError);
  });
});

describe('whole months and years between dates', () => {
  it.each([
    ['2024-01-31', '2024-02-29', 1, 0],
    ['2024-01-31', '2024-02-28', 0, 0],
    ['2024-02-29', '2025-02-28', 12, 1],
    ['2020-05-10', '2026-05-09', 71, 5],
    ['2020-05-10', '2026-05-10', 72, 6],
    ['2026-11-03', '2026-11-03', 0, 0],
  ])('%s to %s: %i months, %i years', (from, to, months, years) => {
    expect(wholeMonthsBetween(date(from), date(to))).toBe(months);
    expect(wholeYearsBetween(date(from), date(to))).toBe(years);
  });

  it('agrees with anchored duration comparisons', () => {
    fc.assert(
      fc.property(
        calendarDates({ maxYear: 9000 }),
        calendarDates({ maxYear: 9000 }),
        fc.integer({ min: 0, max: 1200 }),
        (a, b, months) => {
          const [from, to] = compareDates(a, b) <= 0 ? [a, b] : [b, a];
          const since = elapsedSince(from, duration(`P${String(months)}M`), to);
          expect(wholeMonthsBetween(from, to) >= months).toBe(since);
        },
      ),
    );
  });

  it('rejects a reversed range', () => {
    expect(() => wholeMonthsBetween(date('2026-11-03'), date('2026-11-02'))).toThrow(RangeError);
  });
});

describe('Duration', () => {
  it.each(['P2Y', 'P18M', 'P30D', 'P1Y6M', 'P1Y2M3D', 'P0D'])('accepts %s', (value) => {
    expect(() => duration(value)).not.toThrow();
  });

  it.each(['P', 'PT1H', 'P1W', '2Y', 'P-1Y', 'P1.5Y', 'p1y'])('rejects %s', (value) => {
    expect(() => duration(value)).toThrow();
  });

  it('lists the units it uses', () => {
    expect(durationUnits(duration('P2Y'))).toEqual(['years']);
    expect(durationUnits(duration('P1Y6M'))).toEqual(['years', 'months']);
    expect(durationUnits(duration('P0D'))).toEqual([]);
  });
});

describe('elapsedSince', () => {
  it('holds on the anniversary and not the day before', () => {
    expect(elapsedSince(date('2024-11-03'), duration('P2Y'), date('2026-11-03'))).toBe(true);
    expect(elapsedSince(date('2024-11-03'), duration('P2Y'), date('2026-11-02'))).toBe(false);
  });
});
