import { resources } from '@arca/i18n';
import { regionRatings, suggestedRatings } from '@arca/knowledge';
import { describe, expect, it } from 'vitest';

const { compare, regions } = resources['pt-BR'].translation;

describe('region ratings as the API reads them (ADR-0042)', () => {
  it('ships a file', () => {
    expect(regionRatings).not.toBeNull();
  });

  it('names every region in pt-BR, and nothing else', () => {
    expect(Object.keys(regions).sort()).toEqual([...(regionRatings?.regions ?? [])].sort());
  });

  it('rates only criteria the country file suggests, each with a phrase for its value', () => {
    const countryKeys = new Set(suggestedRatings?.criteria.map(({ id }) => id));
    const phrased = new Set([
      ...Object.keys(compare.suggested.reason),
      ...Object.keys(compare.regionReason),
    ]);
    for (const { id } of regionRatings?.criteria ?? []) {
      expect(countryKeys.has(id), id).toBe(true);
      expect(phrased.has(id), id).toBe(true);
    }
  });

  it('phrases every regional language token', () => {
    const tokens = regionRatings?.criteria
      .find(({ id }) => id === 'language')
      ?.ratings.map(({ value }) => value);
    for (const token of new Set(tokens)) {
      expect(Object.keys(compare.regionReason.language), token).toContain(token);
    }
  });
});
