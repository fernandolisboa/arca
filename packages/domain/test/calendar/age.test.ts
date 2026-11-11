import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type SettledLeapDayBirthday,
  addDays,
  ageYears,
  dateParts,
  isLeapYear,
  parseCalendarDate,
  wholeYearsBetween,
} from '../../src/index.js';
import { calendarDates } from '../arbitraries.js';

const date = parseCalendarDate;
const conventions: SettledLeapDayBirthday[] = ['feb-28', 'march-1'];

describe('ageYears', () => {
  it.each([
    ['2008-11-03', '2026-11-02', 'feb-28', 17],
    ['2008-11-03', '2026-11-03', 'feb-28', 18],
    ['2008-02-29', '2026-02-27', 'feb-28', 17],
    ['2008-02-29', '2026-02-28', 'feb-28', 18],
    ['2008-02-29', '2026-02-28', 'march-1', 17],
    ['2008-02-29', '2026-03-01', 'march-1', 18],
    ['2008-02-29', '2028-02-28', 'march-1', 19],
    ['2008-02-29', '2028-02-29', 'march-1', 20],
    ['2008-02-29', '2028-02-29', 'feb-28', 20],
    ['2026-11-03', '2026-11-03', 'feb-28', 0],
  ] as const)('born %s, on %s (%s): %i', (birth, at, convention, expected) => {
    expect(ageYears(date(birth), date(at), convention)).toBe(expected);
  });

  it('rejects a date before the birth', () => {
    expect(() => ageYears(date('2026-11-03'), date('2026-11-02'), 'feb-28')).toThrow(RangeError);
  });

  it('agrees with whole years for every birthday except 29 February', () => {
    fc.assert(
      fc.property(
        calendarDates({ maxYear: 9000 }),
        fc.integer({ min: 0, max: 40_000 }),
        fc.constantFrom(...conventions),
        (birth, daysLater, convention) => {
          const { month, day } = dateParts(birth);
          fc.pre(!(month === 2 && day === 29));
          const at = addDays(birth, daysLater);
          expect(ageYears(birth, at, convention)).toBe(wholeYearsBetween(birth, at));
        },
      ),
    );
  });

  it('applies the leap-day convention on 29 February birthdays', () => {
    const leapYears = fc
      .integer({ min: 1, max: 2400 })
      .map((n) => n * 4)
      .filter(isLeapYear);
    fc.assert(
      fc.property(leapYears, fc.integer({ min: 0, max: 40_000 }), (year, daysLater) => {
        const birth = date(`${String(year).padStart(4, '0')}-02-29`);
        const at = addDays(birth, daysLater);
        const byDuration = wholeYearsBetween(birth, at);
        expect(ageYears(birth, at, 'feb-28')).toBe(byDuration);
        const { year: atYear, month, day } = dateParts(at);
        const turnsOnFeb28 = month === 2 && day === 28 && !isLeapYear(atYear) && atYear > year;
        expect(ageYears(birth, at, 'march-1')).toBe(byDuration - (turnsOnFeb28 ? 1 : 0));
      }),
    );
  });
});
