import { parseCalendarDate } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import {
  type WorldBankRow,
  indicatorFile,
  roundToHundredths,
  worldBankIndicators,
  worldBankResponseSchema,
} from '../scripts/fetch-world-bank.ts';

describe('roundToHundredths', () => {
  it.each([
    [80, '80'],
    [100, '100'],
    [0.5, '0.5'],
    [19.2752957673079, '19.28'],
    [0.229153196964695, '0.23'],
    [0.125, '0.12'],
    [0.135, '0.14'],
    [45.2, '45.2'],
    [0.001, '0'],
  ])('%d reads %s', (value, expected) => {
    expect(roundToHundredths(value)).toBe(expected);
  });

  it.each([1e-7, 1e21, -1])('refuses %d', (value) => {
    expect(() => roundToHundredths(value)).toThrow(RangeError);
  });
});

describe('indicatorFile', () => {
  const [homicides] = worldBankIndicators;
  const row = (country: string, value: number | null, date = '2023'): WorldBankRow => ({
    indicator: { id: homicides.code, value: 'Intentional homicides (per 100,000 people)' },
    country: { id: country },
    date,
    value,
  });
  const build = (rows: readonly WorldBankRow[]) =>
    indicatorFile({
      indicator: homicides,
      number: 1,
      countriesNumber: 1,
      listNumber: 1,
      countries: ['QM', 'QN', 'QP'],
      rows,
      verifiedAt: parseCalendarDate('2026-11-07'),
    });

  it('keeps each country’s value with its year, sorted, and leaves out a missing one', () => {
    const file = build([row('QN', 6.78, '2022'), row('QM', 0.229), row('QP', null), row('XX', 3)]);
    expect(file.values).toEqual([
      { country: 'QM', value: '0.23', year: 2023, source: 'wdi' },
      { country: 'QN', value: '6.78', year: 2022, source: 'wdi' },
    ]);
    expect(file.sources[0]).toMatchObject({
      url: 'https://data.worldbank.org/indicator/VC.IHR.PSRC.P5',
      kind: 'official',
      verifiedAt: '2026-11-07',
    });
    expect(file.officialDomains).toEqual([{ id: 'worldbank', number: 1 }]);
  });

  it.each<[string, readonly WorldBankRow[]]>([
    ['no values', [row('QM', null)]],
    ['another indicator', [{ ...row('QM', 1), indicator: { id: 'OTHER', value: 'Other' } }]],
    ['a country twice', [row('QM', 1), row('QM', 2)]],
  ])('refuses %s', (_name, rows) => {
    expect(() => build(rows)).toThrow(RangeError);
  });
});

describe('worldBankResponseSchema', () => {
  it('reads an answer with no rows', () => {
    expect(worldBankResponseSchema.parse([{ pages: 0 }, null])[1]).toBeNull();
  });
});
