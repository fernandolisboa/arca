import { describe, expect, it } from 'vitest';
import { formatAmount, formatDateValue } from '../src/questions/format.js';

describe('reading the case back (spec 0007, R5)', () => {
  it.each([
    ['1985', '1985'],
    ['1985-04', 'abril de 1985'],
    ['2026-01-10', '10 de janeiro de 2026'],
  ])('writes the date %s as %s', (value, text) => {
    expect(formatDateValue(value, 'pt-BR')).toBe(text);
  });

  it('writes an amount exactly, in its currency', () => {
    expect(formatAmount({ amount: '9000.5', currency: 'BRL' }, 'pt-BR')).toBe('R$ 9.000,50');
    expect(formatAmount({ amount: '12345678901234567.89', currency: 'EUR' }, 'pt-BR')).toBe(
      '€\u00a012.345.678.901.234.567,89',
    );
  });
});
