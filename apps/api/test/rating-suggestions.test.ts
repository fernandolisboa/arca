import { resources } from '@arca/i18n';
import { suggestedRatings } from '@arca/knowledge';
import { describe, expect, it } from 'vitest';
import { comparisonRatingSuggestions } from '../src/case/rating-suggestions.js';

const { compare } = resources['pt-BR'].translation;

describe('suggested ratings as the API reads them (ADR-0035)', () => {
  it('ships a file', () => {
    expect(suggestedRatings).not.toBeNull();
  });

  it('suggests only for criteria the screen names, each with a phrase for its value', () => {
    const named = new Set([...Object.keys(compare.criterion), ...Object.keys(compare.suggestion)]);
    const phrased = new Set(Object.keys(compare.suggested.reason));
    for (const { id } of suggestedRatings?.criteria ?? []) {
      expect(named.has(id), id).toBe(true);
      expect(phrased.has(id), id).toBe(true);
    }
  });

  it('finds an own criterion named like a ready suggestion', () => {
    const suggestions = comparisonRatingSuggestions(
      suggestedRatings ?? { schemaVersion: 1, number: 1, sources: [], criteria: [] },
    );
    expect(
      suggestions.keyOf({ id: 'own-0000000c', name: compare.suggestion['housing-cost'] }),
    ).toBe('housing-cost');
    expect(suggestions.rating('housing-cost', 'PT')?.source.url).toMatch(/^https:\/\//);
  });
});
