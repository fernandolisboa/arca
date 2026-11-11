import { describe, expect, it } from 'vitest';
import type { CalendarDate } from '../../src/calendar/calendar-date.js';
import {
  type CheckValue,
  canonicalNumber,
  digitsApart,
  numbersIn,
  statesValue,
} from '../../src/independent-check/values.js';

const number = (value: string): CheckValue => ({ kind: 'number', value });
const date = (value: string): CheckValue => ({ kind: 'date', value: value as CalendarDate });

describe('canonicalNumber', () => {
  it.each([
    ['800000.00', '800000'],
    ['1.50', '1.5'],
    ['007', '7'],
    ['0', '0'],
    ['0.25', '0.25'],
  ])('writes %s as %s', (decimal, canonical) => {
    expect(canonicalNumber(decimal)).toBe(canonical);
  });
});

describe('numbersIn', () => {
  it.each([
    ['USD 1,800,000', '1800000'],
    ['EUR 1.800.000', '1800000'],
    ['1 800 000 kr.', '1800000'],
    ['1\u202f800\u202f000', '1800000'],
    ["CHF 1'800'000", '1800000'],
    ['€920,00', '920'],
    ['$1,050.50', '1050.5'],
    ['1.050,50 euros', '1050.5'],
    ['under 21 years', '21'],
    ['between 18 and 21', '18'],
  ])('reads %s as stating %s', (text, expected) => {
    expect(numbersIn(text).has(expected)).toBe(true);
  });

  it.each([
    ['1,80,000', '180000'],
    ['1.800,000.5', '1800000.5'],
    ['12,34,56', '123456'],
    ['1 800', '800'],
    ['1 800 000', '800'],
    ['1 800 000', '0'],
  ])('does not read %s as %s', (text, unexpected) => {
    expect(numbersIn(text).has(unexpected)).toBe(false);
  });

  it('reads two numbers apart by a space both on their own', () => {
    expect([...numbersIn('ages 18 21')]).toEqual(expect.arrayContaining(['18', '21']));
  });
});

describe('digitsApart', () => {
  const reads = (text: string, value: string) =>
    numbersIn(digitsApart(text).replace(/\s+/gu, ' ')).has(value);

  it.each([
    ['a line feed', 'Article 1\n600 EUR'],
    ['a blank line', 'Article 1\n\n600 EUR'],
    ['a carriage return', 'Article 1\r600 EUR'],
    ['a carriage return and a line feed', 'Article 1\r\n600 EUR'],
    ['a form feed', 'Article 1\f600 EUR'],
    ['a line separator', 'Article 1\u2028600 EUR'],
    ['a tab', 'Category 1\t600 EUR'],
    ['a run of spaces', 'Category 1    600 EUR'],
  ])('keeps the digits on two sides of %s apart', (_, text) => {
    expect(reads(text, '600')).toBe(true);
    expect(reads(text, '1600')).toBe(false);
  });

  it('opens a line with a bar only when digits would meet across the break', () => {
    expect(digitsApart('Section 2\n\n  3 months\nor more\n12')).toBe(
      'Section 2\n\n|   3 months\nor more\n12',
    );
  });

  it('leaves a number written with one space between its groups as it is', () => {
    expect(digitsApart('at least 1 600 EUR')).toBe('at least 1 600 EUR');
    expect(reads('at least 1 600 EUR', '1600')).toBe(true);
  });
});

describe('statesValue', () => {
  it.each([
    [number('800000'), 'invest at least $800,000 in a targeted area', true],
    [number('800000'), 'invest at least $1,050,000', false],
    [number('21'), 'unmarried and under 21 years of age', true],
    [number('21'), 'unmarried and under twenty-one', false],
    [number('1.5'), 'multiplied by 1,5', true],
    [date('2026-03-01'), 'in force from 2026-03-01', true],
    [date('2026-03-01'), 'from 1 March 2026', true],
    [date('2026-03-01'), 'a partir de 1 de março de 2026', true],
    [date('2026-03-01'), 'from 2 March 2026', false],
    [date('2026-03-01'), 'from 1 March 2025', false],
    [date('2026-03-01'), 'from 1 January 2026, article 3', false],
    [date('2026-03-01'), '1 de janeiro de 2026', false],
    [date('2026-03-01'), 'od 1 marca 2026 r.', true],
    [date('2026-03-01'), 'from 01/03/2026', false],
    [date('2026-03-01'), 'from 03/01/2026', false],
    [date('2026-03-15'), 'from 15/03/2026', true],
    [date('2026-03-15'), 'from 03/15/2026', true],
    [date('2026-03-15'), 'from 15.03.2026', true],
    [date('2026-03-03'), 'from 03.03.2026', true],
    [date('2024-02-05'), '2024年2月5日から', true],
    [date('2024-02-05'), '2024年12月5日から', false],
    [date('2024-01-01'), '2024年11月1日から', false],
    [date('2024-01-10'), 'החל מ-10 בינואר 2024', true],
    [date('2024-05-15'), 'Applicants may apply within 15 days of the notice in 2024', false],
    [date('2024-05-15'), 'from 15 May 2024', true],
    [date('2024-05-15'), 'ab dem 15. Mai 2024', true],
    [date('2026-03-01'), 'March 1, 2026', true],
    [date('2026-03-01'), 'from 2026.03.01', true],
    [date('2026-03-01'), 'from 02/03/2026', false],
    [date('2026-05-01'), 'from 1 de maio de 2026', true],
    [date('2026-05-01'), 'o maior valor em 1 de junho de 2026', false],
  ])('%o in %s: %s', (value, text, expected) => {
    expect(statesValue(value, text)).toBe(expected);
  });
});
