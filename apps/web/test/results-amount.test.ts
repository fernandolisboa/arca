import { describe, expect, it } from 'vitest';
import { type UnitsMoney, amountForm, shownTotals } from '../src/results/amount.js';

// The contract brands its decimals; these are written out.
const money = (amount: string, currency: string) => ({ amount, currency }) as UnitsMoney;
const eur = (amount: string) => money(amount, 'EUR');

describe('amountForm', () => {
  it('reads one amount, a range, or a single bound', () => {
    expect(amountForm(eur('110'), eur('110'))).toEqual({ kind: 'exact', amount: eur('110') });
    expect(amountForm(eur('90'), eur('110'))).toEqual({
      kind: 'range',
      min: eur('90'),
      max: eur('110'),
    });
    expect(amountForm(eur('90'), null)).toEqual({ kind: 'from', min: eur('90') });
    expect(amountForm(null, eur('110'))).toEqual({ kind: 'upTo', max: eur('110') });
    expect(amountForm(null, null)).toEqual({ kind: 'unknown' });
  });

  it('reads a range from zero as "up to", and from zero with no top as unknown', () => {
    expect(amountForm(eur('0'), eur('110'))).toEqual({ kind: 'upTo', max: eur('110') });
    expect(amountForm(eur('0.00'), null)).toEqual({ kind: 'unknown' });
    expect(amountForm(eur('0'), eur('0'))).toEqual({ kind: 'exact', amount: eur('0') });
  });
});

describe('shownTotals', () => {
  it('leaves out what is nothing, per currency', () => {
    expect(
      shownTotals([
        {
          currency: 'EUR',
          certain: { min: eur('220'), max: eur('220') },
          possibleExtra: { min: eur('0'), max: eur('0') },
        },
        {
          currency: 'USD',
          certain: { min: money('0', 'USD'), max: money('0', 'USD') },
          possibleExtra: { min: money('0', 'USD'), max: null },
        },
      ]),
    ).toEqual({
      certain: [{ kind: 'exact', amount: eur('220') }],
      extra: [{ kind: 'unknown' }],
    });
  });
});
