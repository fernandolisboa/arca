import { describe, expect, it } from 'vitest';
import { nextPreferences } from '../../src/comparison/preferences.js';
import {
  type ComparisonPreferencesRequest,
  comparisonPreferencesRequestSchema,
  maxOwnCriteria,
} from '../../src/comparison/schema.js';
import { preferences } from './fixtures.js';

/** IDs handed out in order, so a test can show a collision being skipped. */
function ids(...values: string[]) {
  const queue = [...values];
  return () => {
    const next = queue.shift();
    if (next === undefined) throw new Error('out of IDs');
    return next;
  };
}

const request = (overrides: Partial<ComparisonPreferencesRequest> = {}) => ({
  ...preferences(),
  ...overrides,
});

describe('writing comparison preferences (ADR-0026)', () => {
  it('names a new own criterion and keeps the existing ones', () => {
    const stored = preferences({ ownCriteria: [{ id: 'own-00000001', name: 'Perto da praia' }] });
    const next = nextPreferences(
      stored,
      request({
        ownCriteria: [{ id: 'own-00000001', name: 'Praia' }, { name: 'Montanhas' }],
        weights: { 'own-00000001': 5, climate: 2 },
      }),
      ids('own-00000002'),
    );
    expect(next).toEqual({
      ...stored,
      weights: { 'own-00000001': 5, climate: 2 },
      ownCriteria: [
        { id: 'own-00000001', name: 'Praia' },
        { id: 'own-00000002', name: 'Montanhas' },
      ],
    });
  });

  it('skips an ID already taken, by a criterion or by a dangling entry', () => {
    const stored = preferences({ ownCriteria: [{ id: 'own-00000001', name: 'Praia' }] });
    const next = nextPreferences(
      stored,
      request({
        ownCriteria: [{ id: 'own-00000001', name: 'Praia' }, { name: 'Montanhas' }],
        weights: { 'own-00000002': 4 },
      }),
      ids('own-00000001', 'own-00000002', 'own-00000003'),
    );
    expect(next?.ownCriteria.map(({ id }) => id)).toEqual(['own-00000001', 'own-00000003']);
    expect(next?.weights).toEqual({});
  });

  it('drops the weights and ratings of a deleted own criterion, and keeps the version’s', () => {
    const stored = preferences({ ownCriteria: [{ id: 'own-00000001', name: 'Praia' }] });
    const next = nextPreferences(
      stored,
      request({
        weights: { 'own-00000001': 5, 'gone-criterion': 1 },
        ratings: { 'own-00000001': { QM: 4 }, climate: { QM: 2 } },
      }),
      ids(),
    );
    expect(next).toEqual(
      preferences({ weights: { 'gone-criterion': 1 }, ratings: { climate: { QM: 2 } } }),
    );
  });

  it('refuses an own criterion ID the person does not have', () => {
    expect(
      nextPreferences(
        preferences(),
        request({ ownCriteria: [{ id: 'own-0000beef', name: 'Praia' }] }),
        ids(),
      ),
    ).toBeUndefined();
  });

  it.each<[string, unknown]>([
    ['a weight above 5', { weights: { climate: 6 } }],
    ['a fractional weight', { weights: { climate: 2.5 } }],
    ['a rating of 0', { ratings: { climate: { QM: 0 } } }],
    ['a lower-case country', { hidden: ['qm'] }],
    ['a country hidden twice', { hidden: ['QM', 'QM'] }],
    ['an empty name', { ownCriteria: [{ name: '  ' }] }],
    ['a name over 60 characters', { ownCriteria: [{ name: 'x'.repeat(61) }] }],
    ['a name with an invisible character', { ownCriteria: [{ name: 'Praia​' }] }],
    ['a name not in NFC', { ownCriteria: [{ name: 'Praiá' }] }],
    ['a client-made ID outside the own namespace', { ownCriteria: [{ id: 'mine', name: 'x' }] }],
    [
      'too many own criteria',
      { ownCriteria: Array.from({ length: maxOwnCriteria + 1 }, () => ({ name: 'x' })) },
    ],
    ['an unknown field', { extra: true }],
  ])('refuses %s', (_name, overrides) => {
    expect(
      comparisonPreferencesRequestSchema.safeParse({ ...preferences(), ...(overrides as object) })
        .success,
    ).toBe(false);
  });
});
