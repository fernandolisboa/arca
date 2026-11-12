import { describe, expect, it } from 'vitest';
import { likelyLanguage, writesNumberInWords } from '../../src/independent-check/number-words.js';
import { statesValue } from '../../src/independent-check/values.js';

describe('numbers a law writes in words (ADR-0027)', () => {
  it.each<[string, string, string[]]>([
    ['a stay of four months', '4', ['en']],
    ['unmarried children under twenty-one', '21', ['en']],
    ['to its second anniversary', '2', ['en']],
    ['uma estada de quatro meses', '4', ['pt']],
    ['maiores de dezoito anos', '18', ['pt']],
    ['há mais de dois anos', '2', ['pt']],
    ['vinte e um anos', '21', ['pt']],
    ['por un período de dos años', '2', ['es']],
    ['menores de dieciocho años', '18', ['es']],
    ['veintiún años', '21', ['es']],
    ['treinta y seis meses', '36', ['es']],
    ['entro trentasei mesi', '36', ['it']],
    ['ventotto giorni', '28', ['it']],
    ['ventitré anni', '23', ['it']],
    ['在留期間は五年', '5', ['ja']],
    ['十八歳未満', '18', ['ja']],
    ['二十一', '21', ['ja']],
    ['UNDER EIGHTEEN', '18', ['en']],
  ])('reads "%s" as %s', (text, value, languages) => {
    expect(writesNumberInWords(text, value, languages)).toBe(true);
  });

  it.each<[string, string, string[], string]>([
    ['the fee is due on filing', '2', ['en', 'pt'], 'a word of a language not given'],
    ['dos filhos menores', '2', ['pt', 'en'], 'a Portuguese word that is Spanish for two'],
    ['segundo o artigo 52.º', '2', ['pt'], 'a word that also means "according to"'],
    ['someone at the office', '1', ['en'], 'a number inside a longer word'],
    ['quatro meses', '4', ['da'], 'a language with no table'],
    ['four months', '5', ['en'], 'another number'],
    ['four months', '4.5', ['en'], 'a value with decimals'],
    ['one hundred and one', '101', ['en'], 'a number past the largest read'],
  ])('does not read "%s" as %s: %s', (text, value, languages) => {
    expect(writesNumberInWords(text, value, languages)).toBe(false);
  });

  it('counts a number in words as the value a quote states, only in the languages given', () => {
    const value = { kind: 'number', value: '4' } as const;
    expect(statesValue(value, 'uma estada de quatro meses', ['pt', 'en'])).toBe(true);
    expect(statesValue(value, 'uma estada de quatro meses')).toBe(false);
    expect(statesValue(value, 'a stay of 4 months')).toBe(true);
  });

  it.each([
    ['PT', 'pt'],
    ['US', 'en'],
    ['AR', 'es'],
    ['JP', 'ja'],
  ])('takes %s laws to be written in %s', (country, language) => {
    expect(likelyLanguage(country)).toBe(language);
  });

  it('knows no language for a code that is not a country', () => {
    expect(likelyLanguage('not a country')).toBeUndefined();
  });
});
