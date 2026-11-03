import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type CalendarDate,
  type ComparisonOperator,
  type DateValue,
  compareDates,
  compareDateValues,
  dateRange,
  elapsedSinceValue,
  elapsedSince,
  parseCalendarDate,
  parseDuration,
  parsePartialDate,
} from '../../src/index.js';
import { calendarDates, durations } from '../arbitraries.js';

const date = parseCalendarDate;
const partial = parsePartialDate;

const operators: ComparisonOperator[] = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'];

function holds(left: CalendarDate, operator: ComparisonOperator, right: CalendarDate): boolean {
  const order = compareDates(left, right);
  const results: Record<ComparisonOperator, boolean> = {
    eq: order === 0,
    ne: order !== 0,
    lt: order < 0,
    lte: order <= 0,
    gt: order > 0,
    gte: order >= 0,
  };
  return results[operator];
}

const partialDates = fc
  .record({
    year: fc.integer({ min: 1, max: 9998 }),
    month: fc.option(fc.integer({ min: 1, max: 12 })),
  })
  .map(({ year, month }) =>
    partial(
      month === null
        ? String(year).padStart(4, '0')
        : `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`,
    ),
  );

const dateValues: fc.Arbitrary<DateValue> = fc.oneof(
  calendarDates({ maxYear: 9998 }),
  partialDates,
);

describe('PartialDate', () => {
  it.each(['1923', '1923-04', '0001'])('accepts %s', (value) => {
    expect(() => partial(value)).not.toThrow();
  });

  it.each(['1923-13', '1923-00', '0000', '23', '1923-4', '1923-04-01'])('rejects %s', (value) => {
    expect(() => partial(value)).toThrow();
  });

  it('spans every day it could be', () => {
    expect(dateRange(partial('1924'))).toEqual({ min: '1924-01-01', max: '1924-12-31' });
    expect(dateRange(partial('1924-02'))).toEqual({ min: '1924-02-01', max: '1924-02-29' });
    expect(dateRange(date('1924-02-10'))).toEqual({ min: '1924-02-10', max: '1924-02-10' });
  });
});

describe('compareDateValues', () => {
  it.each([
    ['1923', 'lt', '1924-01-01', true],
    ['1923', 'lt', '1923-06-01', 'unknown'],
    ['1923-04', 'lt', '1923-06-01', true],
    ['1923-04', 'gte', '1923-04-01', true],
    ['1923-04', 'gt', '1923-04-01', 'unknown'],
    ['1923', 'eq', '1923', 'unknown'],
    ['1923', 'ne', '1925', true],
    ['1923-04-01', 'eq', '1923-04-01', true],
  ] as const)('%s %s %s is %s', (left, operator, right, expected) => {
    const parse = (value: string): DateValue =>
      value.length === 10 ? date(value) : partial(value);
    expect(compareDateValues(parse(left), operator, parse(right))).toBe(expected);
  });

  it('decides only when every date the values could be agrees', () => {
    fc.assert(
      fc.property(
        dateValues,
        dateValues,
        fc.constantFrom(...operators),
        (left, right, operator) => {
          const result = compareDateValues(left, operator, right);
          const leftRange = dateRange(left);
          const rightRange = dateRange(right);
          const corners = [leftRange.min, leftRange.max].flatMap((l) =>
            [rightRange.min, rightRange.max].map((r) => holds(l, operator, r)),
          );
          if (result !== 'unknown') {
            expect(corners.every((corner) => corner === result)).toBe(true);
          }
          if (left.length === 10 && right.length === 10) {
            expect(result).toBe(holds(left as CalendarDate, operator, right as CalendarDate));
          }
        },
      ),
    );
  });
});

describe('elapsedSinceValue', () => {
  it('is unknown while the partial start straddles the threshold', () => {
    const p18y = parseDuration('P18Y');
    expect(elapsedSinceValue(partial('2008'), p18y, date('2027-01-01'))).toBe(true);
    expect(elapsedSinceValue(partial('2008'), p18y, date('2025-12-31'))).toBe(false);
    expect(elapsedSinceValue(partial('2008'), p18y, date('2026-06-01'))).toBe('unknown');
  });

  it('matches elapsedSince on full dates', () => {
    fc.assert(
      fc.property(
        calendarDates({ maxYear: 9000 }),
        durations(),
        calendarDates({ maxYear: 9000 }),
        (start, added, reference) => {
          expect(elapsedSinceValue(start, added, reference)).toBe(
            elapsedSince(start, added, reference),
          );
        },
      ),
    );
  });
});
