import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type FxTable,
  compareMoney,
  convert,
  findRate,
  fxTableSchema,
  money,
  parseCalendarDate,
  roundHalfEven,
  toExact,
} from '../../src/index.js';

const date = parseCalendarDate;

function table(rates: { from: string; to: string; rate: string; date: string }[]): FxTable {
  return fxTableSchema.parse({ rates: rates.map((rate) => ({ ...rate, source: 'fixture' })) });
}

const usdToEur = table([
  { from: 'USD', to: 'EUR', rate: '0.9', date: '2026-10-20' },
  { from: 'USD', to: 'EUR', rate: '0.92', date: '2026-10-30' },
  { from: 'USD', to: 'EUR', rate: '0.95', date: '2026-11-05' },
  { from: 'USD', to: 'JPY', rate: '150.25', date: '2026-10-30' },
  { from: 'JPY', to: 'KWD', rate: '0.002', date: '2026-10-30' },
]);

describe('findRate', () => {
  it('takes the latest rate on or before the facts date', () => {
    expect(findRate(usdToEur, { from: 'USD', to: 'EUR' }, date('2026-11-03'))?.rate).toBe('0.92');
  });

  it('ignores rates more than 7 days older', () => {
    expect(findRate(usdToEur, { from: 'USD', to: 'EUR' }, date('2026-11-06'))?.rate).toBe('0.95');
    expect(findRate(usdToEur, { from: 'USD', to: 'EUR' }, date('2026-11-04'))?.rate).toBe('0.92');
    expect(findRate(usdToEur, { from: 'USD', to: 'EUR' }, date('2026-10-27'))?.rate).toBe('0.9');
    expect(findRate(usdToEur, { from: 'USD', to: 'EUR' }, date('2026-10-29'))).toBeUndefined();
  });

  it('never inverts a pair', () => {
    expect(findRate(usdToEur, { from: 'EUR', to: 'USD' }, date('2026-11-03'))).toBeUndefined();
  });

  it('refuses a table with two rates for the same pair and date', () => {
    expect(() =>
      table([
        { from: 'USD', to: 'EUR', rate: '0.9', date: '2026-10-30' },
        { from: 'USD', to: 'EUR', rate: '0.91', date: '2026-10-30' },
      ]),
    ).toThrow();
    const unchecked = {
      rates: [
        { from: 'USD', to: 'EUR', rate: '0.9', date: '2026-10-30', source: 'a' },
        { from: 'USD', to: 'EUR', rate: '0.91', date: '2026-10-30', source: 'b' },
      ],
    } as FxTable;
    expect(() => findRate(unchecked, { from: 'USD', to: 'EUR' }, date('2026-11-03'))).toThrow(
      RangeError,
    );
  });

  it.each([
    [{ from: 'USD', to: 'USD', rate: '1', date: '2026-10-30' }],
    [{ from: 'USD', to: 'EUR', rate: '0', date: '2026-10-30' }],
    [{ from: 'USD', to: 'EUR', rate: '-0.9', date: '2026-10-30' }],
    [{ from: 'USD', to: 'EUR', rate: '0.9', date: '2026-02-30' }],
  ])('refuses an invalid rate %#', (rate) => {
    expect(() => table([rate])).toThrow();
  });
});

describe('convert', () => {
  it('converts exactly between currencies with different minor units', () => {
    const result = convert(toExact(money(10_000, 'USD')), 'JPY', usdToEur, date('2026-11-03'));
    expect(result.kind).toBe('converted');
    if (result.kind !== 'converted') return;
    expect(roundHalfEven(result.amount)).toEqual({ amount: 15_025, currency: 'JPY' });
    expect(result.rate?.date).toBe('2026-10-30');

    const kwd = convert(toExact(money(1_001, 'JPY')), 'KWD', usdToEur, date('2026-11-03'));
    if (kwd.kind !== 'converted') throw new Error('expected a conversion');
    expect(compareMoney(kwd.amount, { units: 2002n, scale: 0, currency: 'KWD' })).toBe(0);
  });

  it('keeps fractions until the comparison', () => {
    const result = convert(toExact(money(1, 'USD')), 'EUR', usdToEur, date('2026-11-03'));
    if (result.kind !== 'converted') throw new Error('expected a conversion');
    expect(compareMoney(result.amount, { units: 92n, scale: 2, currency: 'EUR' })).toBe(0);
    expect(roundHalfEven(result.amount).amount).toBe(1);
  });

  it('leaves an amount in the same currency untouched', () => {
    const amount = toExact(money(500, 'EUR'));
    expect(convert(amount, 'EUR', usdToEur, date('2026-11-03'))).toEqual({
      kind: 'converted',
      amount,
    });
  });

  it('reports a missing rate instead of guessing', () => {
    expect(convert(toExact(money(500, 'BRL')), 'EUR', usdToEur, date('2026-11-03'))).toEqual({
      kind: 'missing_rate',
      pair: { from: 'BRL', to: 'EUR' },
    });
  });

  it('rounds a conversion within half a minor unit of the exact value', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 6 }),
        (cents, rateUnits, rateScale) => {
          const rate = (rateUnits / 10 ** rateScale).toFixed(rateScale);
          const rates = table([{ from: 'USD', to: 'EUR', rate, date: '2026-11-01' }]);
          const result = convert(toExact(money(cents, 'USD')), 'EUR', rates, date('2026-11-03'));
          if (result.kind !== 'converted') throw new Error('expected a conversion');
          const exactTimesScale = BigInt(cents) * BigInt(rateUnits);
          const rounded = BigInt(roundHalfEven(result.amount).amount);
          const distance = exactTimesScale - rounded * 10n ** BigInt(rateScale);
          expect((distance < 0n ? -distance : distance) * 2n <= 10n ** BigInt(rateScale)).toBe(
            true,
          );
        },
      ),
    );
  });
});
