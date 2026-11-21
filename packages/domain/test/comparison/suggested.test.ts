import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import { compareDestinations } from '../../src/comparison/score.js';
import {
  type SuggestedRatings,
  ratingSuggestions,
  suggestedRatingsSchema,
} from '../../src/comparison/suggested.js';
import { entry, personalCriterion, preferences } from './fixtures.js';

const today = parseCalendarDate('2026-11-21');

const file: SuggestedRatings = {
  schemaVersion: 1,
  number: 1,
  sources: [
    {
      id: 'synthetic',
      url: 'https://example.org/data',
      title: 'Synthetic source',
      kind: 'official',
      verifiedAt: parseCalendarDate('2026-11-21'),
    },
  ],
  criteria: [
    {
      id: 'climate',
      ratings: [
        { country: 'QM', stars: 4, value: '18.5', year: 2020, source: 'synthetic' },
        { country: 'QN', stars: 1, value: '2.0', source: 'synthetic' },
      ],
    },
    {
      id: 'housing-cost',
      ratings: [{ country: 'QM', stars: 2, value: '210', source: 'synthetic' }],
    },
  ],
};

const names = { climate: 'Clima', 'housing-cost': 'Custo da moradia', unrated: 'Sem dados' };
const suggestions = ratingSuggestions(file, names);

describe('suggested ratings file (ADR-0035)', () => {
  it('accepts a well-formed file', () => {
    expect(suggestedRatingsSchema.safeParse(file).success).toBe(true);
  });

  it.each([
    [
      'a source it does not list',
      {
        ...file,
        criteria: [
          { id: 'climate', ratings: [{ country: 'QM', stars: 3, value: '1', source: 'other' }] },
        ],
      },
    ],
    [
      'two ratings for one country',
      {
        ...file,
        criteria: [
          {
            id: 'climate',
            ratings: [
              { country: 'QM', stars: 3, value: '1', source: 'synthetic' },
              { country: 'QM', stars: 4, value: '2', source: 'synthetic' },
            ],
          },
        ],
      },
    ],
    ['a repeated criterion', { ...file, criteria: [file.criteria[0], file.criteria[0]] }],
    [
      'stars outside 1 to 5',
      {
        ...file,
        criteria: [
          {
            id: 'climate',
            ratings: [{ country: 'QM', stars: 6, value: '1', source: 'synthetic' }],
          },
        ],
      },
    ],
    [
      'a value that is neither a decimal nor a token',
      {
        ...file,
        criteria: [
          {
            id: 'climate',
            ratings: [{ country: 'QM', stars: 3, value: '<b>', source: 'synthetic' }],
          },
        ],
      },
    ],
  ])('refuses %s', (_name, candidate) => {
    expect(suggestedRatingsSchema.safeParse(candidate).success).toBe(false);
  });
});

describe('rating suggestions (ADR-0035)', () => {
  it('finds a personal criterion by its ID', () => {
    expect(suggestions.keyOf({ id: 'climate' })).toBe('climate');
    expect(suggestions.keyOf({ id: 'schools' })).toBeUndefined();
  });

  it.each([
    ['the same name', 'Custo da moradia', 'housing-cost'],
    ['another case and no accents', '  custo DA moradia ', 'housing-cost'],
    ['a renamed criterion', 'Aluguel', undefined],
    ['a name whose key has no ratings', 'Sem dados', undefined],
  ])('finds an own criterion by %s', (_name, name, key) => {
    expect(suggestions.keyOf({ id: 'own-0000000a', name })).toBe(key);
  });

  it('answers the stars with their key, value, year and source', () => {
    expect(suggestions.rating('climate', 'QM')).toEqual({
      key: 'climate',
      stars: 4,
      value: '18.5',
      year: 2020,
      source: file.sources[0],
    });
    expect(suggestions.rating('climate', 'QZ')).toBeUndefined();
  });
});

describe('suggested stars in the comparison (ADR-0035)', () => {
  const ownId = 'own-0000000b';
  const compare = (overrides: Parameters<typeof preferences>[0] = {}) =>
    compareDestinations({
      entry: entry([personalCriterion('climate', 2)], []),
      preferences: preferences({
        ownCriteria: [{ id: ownId, name: 'Custo da moradia' }],
        ...overrides,
      }),
      countries: ['QM', 'QN', 'QZ'],
      today,
      suggestions,
    });

  it('scores an unrated criterion from the suggestion and ranks a country nobody rated', () => {
    const qm = compare().countries.find(({ country }) => country === 'QM');
    expect(qm?.group).toBe('ranked');
    expect(qm?.coverage).toBe(100);
    // Climate 4 stars (7.5) at weight 2, housing 2 stars (2.5) at weight 3: (15 + 7.5) / 5.
    expect(qm?.total).toBe('4.5');
    expect(qm?.scores.map(({ rating, suggested }) => [rating, suggested?.stars])).toEqual([
      [undefined, 4],
      [undefined, 2],
    ]);
  });

  it('lets the person’s own stars win and keeps the suggestion beside them', () => {
    const qm = compare({ ratings: { climate: { QM: 1 } } }).countries.find(
      ({ country }) => country === 'QM',
    );
    expect(qm?.scores[0]).toMatchObject({
      score: '0',
      rating: 1,
      suggested: { stars: 4, stale: false },
    });
  });

  it('leaves a country without a suggestion unknown', () => {
    const qz = compare().countries.find(({ country }) => country === 'QZ');
    expect(
      qz?.scores.every(({ score, suggested }) => score === null && suggested === undefined),
    ).toBe(true);
    expect(qz?.group).toBe('few-data');
  });

  it('scores nothing from suggestions when none are given', () => {
    const result = compareDestinations({
      entry: entry([personalCriterion('climate')], []),
      preferences: preferences(),
      countries: ['QM'],
      today,
    });
    expect(result.countries[0]?.scores[0]).toEqual({ criterion: 'climate', score: null });
  });
});

describe('a suggestion whose source is old (ADR-0035)', () => {
  it('is flagged stale after 90 days, like an indicator reading', () => {
    const result = compareDestinations({
      entry: entry([personalCriterion('climate')], []),
      preferences: preferences(),
      countries: ['QM'],
      today: parseCalendarDate('2027-03-01'),
      suggestions,
    });
    expect(result.countries[0]?.scores[0]?.suggested?.stale).toBe(true);
  });
});
