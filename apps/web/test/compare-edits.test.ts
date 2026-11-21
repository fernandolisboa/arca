import { describe, expect, it } from 'vitest';
import { maxDismissedSuggestions } from '@arca/api-contract/client';
import { applyEdit, type Edit, type Preferences } from '../src/compare/edits.js';

const start: Preferences = {
  weights: { safety: 4, 'own-0000000a': 2 },
  ratings: { climate: { PT: 4, ES: 5 }, 'own-0000000a': { PT: 3 } },
  ownCriteria: [{ id: 'own-0000000a', name: 'Perto da praia' }],
  hidden: ['US'],
  dismissed: [],
};

const after = (...edits: Edit[]) => edits.reduce(applyEdit, start);

describe('Comparison edits', () => {
  it.each<[string, Edit, Partial<Preferences>]>([
    [
      'sets a weight',
      { kind: 'weight', criterion: 'climate', weight: 0 },
      {
        weights: { safety: 4, 'own-0000000a': 2, climate: 0 },
      },
    ],
    [
      'changes a rating',
      { kind: 'rating', criterion: 'climate', country: 'PT', rating: 1 },
      {
        ratings: { climate: { ES: 5, PT: 1 }, 'own-0000000a': { PT: 3 } },
      },
    ],
    [
      'adds a rating to a new criterion',
      {
        kind: 'rating',
        criterion: 'schools',
        country: 'UY',
        rating: 2,
      },
      {
        ratings: { climate: { PT: 4, ES: 5 }, 'own-0000000a': { PT: 3 }, schools: { UY: 2 } },
      },
    ],
    [
      'takes a rating away',
      {
        kind: 'rating',
        criterion: 'climate',
        country: 'ES',
        rating: undefined,
      },
      { ratings: { climate: { PT: 4 }, 'own-0000000a': { PT: 3 } } },
    ],
    [
      'drops the criterion with its last rating, as the API asks',
      {
        kind: 'rating',
        criterion: 'own-0000000a',
        country: 'PT',
        rating: undefined,
      },
      { ratings: { climate: { PT: 4, ES: 5 } } },
    ],
    ['hides a country', { kind: 'hide', country: 'PT' }, { hidden: ['US', 'PT'] }],
    ['hides a country once', { kind: 'hide', country: 'US' }, { hidden: ['US'] }],
    ['shows a country again', { kind: 'show', country: 'US' }, { hidden: [] }],
    [
      'adds an own criterion without an ID, for the API to name',
      {
        kind: 'add',
        name: 'Neve',
      },
      {
        ownCriteria: [{ id: 'own-0000000a', name: 'Perto da praia' }, { name: 'Neve' }],
      },
    ],
    [
      'renames an own criterion',
      {
        kind: 'rename',
        criterion: 'own-0000000a',
        name: 'Praia',
      },
      { ownCriteria: [{ id: 'own-0000000a', name: 'Praia' }] },
    ],
    [
      'deletes an own criterion with its weight and ratings',
      {
        kind: 'remove',
        criterion: 'own-0000000a',
      },
      { ownCriteria: [], weights: { safety: 4 }, ratings: { climate: { PT: 4, ES: 5 } } },
    ],
  ])('%s', (_, edit, changed) => {
    expect(applyEdit(start, edit)).toEqual({ ...start, ...changed });
  });

  it('adds a suggestion at its weight and takes it back before the API names it', () => {
    const added = after({ kind: 'add', name: 'Voo direto', weight: 4 });
    expect(added.ownCriteria.at(-1)).toEqual({ name: 'Voo direto', weight: 4 });
    expect(applyEdit(added, { kind: 'unadd', name: 'Voo direto' })).toEqual(start);
  });

  it('takes back a suggestion the API already named, with its weight and ratings', () => {
    expect(after({ kind: 'unadd', name: 'Perto da praia' })).toEqual(
      after({ kind: 'remove', criterion: 'own-0000000a' }),
    );
  });

  it('turns a suggestion down once and brings it back', () => {
    const dismissed = after({ kind: 'dismiss', name: 'Praia' }, { kind: 'dismiss', name: 'Praia' });
    expect(dismissed.dismissed).toEqual(['Praia']);
    expect(applyEdit(dismissed, { kind: 'undismiss', name: 'Praia' })).toEqual(start);
  });

  it('drops the oldest turned-down name at the cap, so the next write still saves', () => {
    const full = {
      ...start,
      dismissed: Array.from({ length: maxDismissedSuggestions }, (_, i) => `n${String(i)}`),
    };
    const next = applyEdit(full, { kind: 'dismiss', name: 'Praia' });
    expect(next.dismissed).toHaveLength(maxDismissedSuggestions);
    expect(next.dismissed.at(0)).toBe('n1');
    expect(next.dismissed.at(-1)).toBe('Praia');
  });

  it('applies edits in order, leaving the input alone', () => {
    const copy = structuredClone(start);
    expect(
      after(
        { kind: 'weight', criterion: 'safety', weight: 5 },
        { kind: 'weight', criterion: 'safety', weight: 1 },
        { kind: 'hide', country: 'PT' },
        { kind: 'show', country: 'PT' },
      ),
    ).toEqual({ ...start, weights: { safety: 1, 'own-0000000a': 2 } });
    expect(start).toEqual(copy);
  });
});
