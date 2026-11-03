import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ExactAmount,
  addExact,
  compareExact,
  maxExact,
  minExact,
  minorUnitExponent,
  money,
  multiplyExact,
  parseDecimal,
  roundHalfEven,
  subtractExact,
  sumExact,
  toExact,
} from '../../src/index.js';

const eur = (amount: number): ExactAmount => toExact(money(amount, 'EUR'));
const safeAmounts = fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 });

describe('currencies', () => {
  it.each([
    ['EUR', 2],
    ['USD', 2],
    ['BRL', 2],
    ['JPY', 0],
    ['KWD', 3],
    ['CLF', 4],
  ] as const)('%s has %i minor digits', (currency, exponent) => {
    expect(minorUnitExponent(currency)).toBe(exponent);
  });

  it('rejects an unknown code and a fractional amount', () => {
    expect(() => money(100, 'XAU' as 'EUR')).toThrow();
    expect(() => money(1.5, 'EUR')).toThrow();
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, 'EUR')).toThrow();
  });
});

describe('Decimal', () => {
  it.each(['0', '1', '-1.5', '0.000000000001', '123456789012345678.123456789012', '1.50'])(
    'accepts %s',
    (value) => {
      expect(() => parseDecimal(value)).not.toThrow();
    },
  );

  it.each(['', '.5', '1.', '01', '1e3', '0.0000000000001', '-0', '-0.00', '+1', '1,5', 'NaN'])(
    'rejects %s',
    (value) => {
      expect(() => parseDecimal(value)).toThrow();
    },
  );
});

describe('exact arithmetic', () => {
  it('adds, subtracts and compares like integers', () => {
    fc.assert(
      fc.property(safeAmounts, safeAmounts, (a, b) => {
        expect(roundHalfEven(addExact(eur(a), eur(b))).amount).toBe(a + b);
        expect(roundHalfEven(subtractExact(eur(a), eur(b))).amount).toBe(a - b);
        expect(compareExact(eur(a), eur(b))).toBe(Math.sign(a - b));
        expect(roundHalfEven(minExact(eur(a), eur(b))).amount).toBe(Math.min(a, b));
        expect(roundHalfEven(maxExact(eur(a), eur(b))).amount).toBe(Math.max(a, b));
      }),
    );
  });

  it('is associative and commutative', () => {
    fc.assert(
      fc.property(safeAmounts, safeAmounts, safeAmounts, (a, b, c) => {
        const left = addExact(addExact(eur(a), eur(b)), eur(c));
        const right = addExact(eur(a), addExact(eur(c), eur(b)));
        expect(compareExact(left, right)).toBe(0);
      }),
    );
  });

  it('compares a multiplied amount exactly, before rounding', () => {
    const share = multiplyExact(eur(87_000), parseDecimal('0.5'));
    expect(compareExact(share, eur(43_500))).toBe(0);
    const third = multiplyExact(eur(100), parseDecimal('0.333333333333'));
    expect(compareExact(third, eur(33))).toBe(1);
    expect(compareExact(multiplyExact(eur(1), parseDecimal('0.5')), eur(0))).toBe(1);
  });

  it('refuses to mix currencies', () => {
    const usd = toExact(money(100, 'USD'));
    expect(() => addExact(eur(100), usd)).toThrow(RangeError);
    expect(() => compareExact(eur(100), usd)).toThrow(RangeError);
  });

  it('sums to zero when empty', () => {
    expect(roundHalfEven(sumExact([], 'EUR'))).toEqual({ amount: 0, currency: 'EUR' });
  });
});

describe('roundHalfEven', () => {
  it.each([
    ['0.5', 0],
    ['1.5', 2],
    ['2.5', 2],
    ['2.500000000001', 3],
    ['2.499999999999', 2],
    ['-0.5', 0],
    ['-1.5', -2],
    ['-2.5', -2],
    ['-2.6', -3],
  ])('%s rounds to %i', (factor, expected) => {
    expect(roundHalfEven(multiplyExact(eur(1), parseDecimal(factor))).amount).toBe(expected);
  });

  it('rounds to the nearest unit, ties to even', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.integer({ min: 0, max: 12 }),
        (units, scale) => {
          const rounded = BigInt(roundHalfEven({ units, scale, currency: 'EUR' }).amount);
          const divisor = 10n ** BigInt(scale);
          const distance = units - rounded * divisor;
          const twiceDistance = (distance < 0n ? -distance : distance) * 2n;
          expect(twiceDistance <= divisor).toBe(true);
          if (twiceDistance === divisor) expect(rounded % 2n).toBe(0n);
        },
      ),
    );
  });

  it('refuses an amount outside the safe range', () => {
    expect(() =>
      roundHalfEven(multiplyExact(eur(Number.MAX_SAFE_INTEGER), parseDecimal('2'))),
    ).toThrow(RangeError);
  });
});
