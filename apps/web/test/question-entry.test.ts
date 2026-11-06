import { describe, expect, it } from 'vitest';
import {
  amountText,
  amountValue,
  dateParts,
  sentAnswer,
  joinDate,
  percentFromShare,
  shareFromPercent,
} from '../src/questions/entry.js';

describe('typing in the guided questions (spec 0007, R4)', () => {
  it.each([
    ['1985', { year: '1985', month: '', day: '' }],
    ['1985-04', { year: '1985', month: '04', day: '' }],
    ['1985-04-12', { year: '1985', month: '04', day: '12' }],
  ])('splits and joins %s', (value, parts) => {
    expect(dateParts(value)).toEqual(parts);
    expect(joinDate(parts)).toBe(value);
  });

  it('has no date without a year', () => {
    expect(joinDate({ year: '', month: '04', day: '' })).toBeUndefined();
    expect(dateParts('none')).toEqual({ year: '', month: '', day: '' });
  });

  it.each([
    ['1.234,50', '1234.50'],
    ['900', '900'],
    [' 12,5 ', '12.5'],
    ['1.500', '1500'],
    ['1.234.567', '1234567'],
    ['1500.50', '1500.50'],
    ['2.5', '2.5'],
    ['1.5,0', '1.5,0'],
    ['0.500', '0.500'],
  ])('reads the amount %s as %s', (text, value) => {
    expect(amountValue(text)).toBe(value);
  });

  it('writes an amount with a decimal comma', () => {
    expect(amountText('1234.5')).toBe('1234,5');
  });

  it.each([
    ['100', '1'],
    ['50', '0.5'],
    ['33,33', '0.3333'],
    ['5', '0.05'],
    ['0,5', '0.005'],
  ])('reads %s%% as the share %s', (percent, share) => {
    expect(shareFromPercent(percent)).toBe(share);
  });

  it.each([
    ['1.000000', '100'],
    ['0.500000', '50'],
    ['0.3333', '33,33'],
    ['0.05', '5'],
  ])('shows the share %s as %s%%', (share, percent) => {
    expect(percentFromShare(share)).toBe(percent);
  });

  it('refuses a percentage that is not a number', () => {
    expect(shareFromPercent('metade')).toBeUndefined();
  });

  it('sends a removed saved item as dropped, and leaves "Não sei" fields out', () => {
    const saved = [
      { id: 'a', kind: 'cash' },
      { id: 'b', kind: 'vehicle' },
    ];
    expect(
      sentAnswer([{ id: 'a', kind: 'cash', liquid: null }, { kind: 'business' }], saved),
    ).toEqual([{ id: 'a', kind: 'cash' }, { kind: 'business' }, { id: 'b', dropped: true }]);
    expect(sentAnswer([], saved)).toEqual([
      { id: 'a', dropped: true },
      { id: 'b', dropped: true },
    ]);
    expect(sentAnswer([{ id: 'a' }], [{ id: 'a' }])).toEqual([{ id: 'a' }]);
    expect(sentAnswer(null, saved)).toBeNull();
    expect(sentAnswer('1985', undefined)).toBe('1985');
  });
});
