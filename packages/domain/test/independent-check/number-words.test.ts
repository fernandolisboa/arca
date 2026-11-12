import { describe, expect, it } from 'vitest';
import {
  likelyLanguage,
  pageLanguages,
  writesNumberInWords,
} from '../../src/independent-check/number-words.js';
import { statesValue } from '../../src/independent-check/values.js';

describe('numbers a law writes in words (ADR-0027)', () => {
  it.each<[string, string, string[]]>([
    ['a stay of four months', '4', ['en']],
    ['unmarried children under twenty-one', '21', ['en']],
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
    ['cinco anos e dois meses', '2', ['pt']],
    ['ventitré anni', '23', ['it']],
    ['ventidue anni', '22', ['it', 'en']],
    ['在留期間は五年', '5', ['ja']],
    ['十八歳未満', '18', ['ja']],
    ['二十一歳', '21', ['ja']],
    ['六箇月', '6', ['ja']],
    ['UNDER EIGHTEEN', '18', ['en']],
  ])('reads "%s" as %s', (text, value, languages) => {
    expect(writesNumberInWords(text, value, languages)).toBe(true);
  });

  it.each<[string, string, string[], string]>([
    ['the fee is due on filing', '2', ['en', 'pt'], 'a word of a language not given'],
    ['dos filhos menores', '2', ['pt', 'en'], 'a Portuguese word that is Spanish for two'],
    ['第五日', '5', ['ja'], 'a kanji ordinal'],
    ['segundo o artigo 52.º', '2', ['pt'], 'a word that also means "according to"'],
    ['nineteen at the office', '9', ['en'], 'a number inside a longer word'],
    ['um dos requisitos', '1', ['pt'], 'an article'],
    ['one of the conditions', '1', ['en'], 'a pronoun'],
    ['under twenty-one years', '20', ['en'], 'the ten of a larger number'],
    ['under twenty-two years', '2', ['en'], 'the unit of a larger number'],
    ['vinte e dois anos', '2', ['pt'], 'the unit after a joiner'],
    ['treinta y dos meses', '30', ['es'], 'the ten before a joiner'],
    ['cinco mil euros', '5', ['es'], 'a number of thousands'],
    ['three hundred days', '3', ['en'], 'a number of hundreds'],
    ['dois e meio anos', '2', ['pt'], 'a run that ends in a joiner'],
    ['to its second anniversary', '2', ['en'], 'an ordinal'],
    ['fees are due within 30 days', '2', ['it', 'en'], 'an Italian number that is an English word'],
    ['once approved', '11', ['es', 'en'], 'a Spanish number that is an English word'],
    ['dieci per cento', '100', ['it'], 'a number past the largest read'],
    ["secondo l'articolo 9", '2', ['it'], 'a word that also means "according to"'],
    ['一般の場合', '1', ['ja'], 'a numeral inside a word'],
    ['十分な資産', '10', ['ja'], 'a numeral with no counter'],
    ['quatro meses', '4', ['da'], 'a language with no table'],
    ['four months', '5', ['en'], 'another number'],
    ['four months', '4.5', ['en'], 'a value with decimals'],
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

  it("reads a country's pages in its likely language and English", () => {
    expect(pageLanguages('PT')).toEqual(['pt', 'en']);
    expect(pageLanguages('US')).toEqual(['en']);
  });

  it('knows no language for a code that is not a country', () => {
    expect(likelyLanguage('not a country')).toBeUndefined();
  });
});
