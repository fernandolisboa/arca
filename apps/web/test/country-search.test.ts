import { describe, expect, it } from 'vitest';
import { matchesSearch } from '../src/forms/country-search.js';

describe('matchesSearch', () => {
  it.each([
    ['Letônia', 'leto'],
    ['Letônia', 'LETÔ'],
    ['Estados Unidos', 'unidos'],
    ['Japão', '  japao '],
    ['Portugal', ''],
  ])('finds %s for %j', (name, search) => {
    expect(matchesSearch(name, search)).toBe(true);
  });

  it.each([
    ['Portugal', 'porto'],
    ['Chile', 'china'],
  ])('leaves %s out for %j', (name, search) => {
    expect(matchesSearch(name, search)).toBe(false);
  });
});
