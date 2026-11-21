import { describe, expect, it } from 'vitest';
import { openSuggestions } from '../src/compare/suggestions.js';

describe('openSuggestions', () => {
  const flight = { name: 'Voo direto para o Brasil', weight: 2 };
  const housing = { name: 'Custo da moradia', weight: 4 };

  it('keeps what the person neither has nor turned down', () => {
    expect(openSuggestions([flight, housing], { taken: [], dismissed: [] })).toEqual([
      flight,
      housing,
    ]);
  });

  it('leaves out one named like a criterion the person has, ignoring case and accents', () => {
    expect(
      openSuggestions([flight, housing], { taken: ['custo da MORADÍA '], dismissed: [] }),
    ).toEqual([flight]);
  });

  it('leaves out one the person turned down', () => {
    expect(
      openSuggestions([flight, housing], { taken: [], dismissed: ['Voo direto para o Brasil'] }),
    ).toEqual([housing]);
  });

  it('keeps only the first of two alike', () => {
    expect(
      openSuggestions([flight, { ...flight, weight: 5 }], { taken: [], dismissed: [] }),
    ).toEqual([flight]);
  });
});
