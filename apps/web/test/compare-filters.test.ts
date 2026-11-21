import { describe, expect, it } from 'vitest';
import { noFilter, passesFilter } from '../src/compare/filters.js';

describe('passesFilter', () => {
  const scored = { name: 'Portugal', total: '7.5' };
  const unscored = { name: 'Japão', total: null };

  it('shows every country with no filter', () => {
    expect([scored, unscored].filter((each) => passesFilter(each, noFilter))).toEqual([
      scored,
      unscored,
    ]);
  });

  it.each([
    ['scored', scored],
    ['unscored', unscored],
  ] as const)('keeps only the %s countries', (score, kept) => {
    expect([scored, unscored].filter((each) => passesFilter(each, { search: '', score }))).toEqual([
      kept,
    ]);
  });

  it('searches the shown name, ignoring case and accents', () => {
    expect(passesFilter(unscored, { search: 'JAPAO', score: 'all' })).toBe(true);
    expect(passesFilter(scored, { search: 'japao', score: 'all' })).toBe(false);
  });

  it('applies the search and the score together', () => {
    expect(passesFilter(unscored, { search: 'jap', score: 'scored' })).toBe(false);
  });
});
