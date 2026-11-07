import { describe, expect, it } from 'vitest';
import type { CalendarDate } from '../../src/calendar/calendar-date.js';
import {
  type CheckValue,
  canonicalNumber,
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
    [date('2026-03-01'), 'from 01/03/2026', true],
    [date('2026-03-01'), 'from 03/01/2026', true],
    [date('2026-03-01'), 'from 2026.03.01', true],
    [date('2026-03-01'), 'from 02/03/2026', false],
    [date('2026-05-01'), 'from 1 de maio de 2026', true],
    [date('2026-05-01'), 'o maior valor em 1 de junho de 2026', false],
  ])('%o in %s: %s', (value, text, expected) => {
    expect(statesValue(value, text)).toBe(expected);
  });
});
