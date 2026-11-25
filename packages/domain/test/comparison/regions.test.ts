import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import {
  type RegionRatings,
  placeCodeSchema,
  regionRatingsSchema,
  regionSuggestions,
} from '../../src/comparison/regions.js';
import { compareDestinations } from '../../src/comparison/score.js';
import { type SuggestedRatings, ratingSuggestions } from '../../src/comparison/suggested.js';
import {
  decimalIndicator,
  entry,
  indicatorCriterion,
  personalCriterion,
  preferences,
} from './fixtures.js';

const today = parseCalendarDate('2026-11-25');
const source = {
  id: 'synthetic',
  url: 'https://example.org/data',
  title: 'Synthetic source',
  kind: 'official' as const,
  verifiedAt: today,
};

const countryFile: SuggestedRatings = {
  schemaVersion: 1,
  number: 1,
  sources: [source],
  criteria: [
    { id: 'climate', ratings: [{ country: 'QM', stars: 3, value: '12.0', source: 'synthetic' }] },
  ],
};

const regionFile: RegionRatings = {
  schemaVersion: 1,
  number: 1,
  sources: [source],
  regions: ['QM-02', 'QM-01', 'QM-03'],
  criteria: [
    {
      id: 'climate',
      ratings: [
        { region: 'QM-01', stars: 5, value: '21.0', source: 'synthetic' },
        { region: 'QM-02', stars: 1, value: '4.0', source: 'synthetic' },
      ],
    },
  ],
};

const regions = regionSuggestions(regionFile);
const suggestions = ratingSuggestions(countryFile, { climate: 'Clima' });

describe('regions file (ADR-0042)', () => {
  it('accepts a well-formed file', () => {
    expect(regionRatingsSchema.safeParse(regionFile).success).toBe(true);
  });

  it.each([
    [
      'a rating for a region it does not list',
      {
        ...regionFile,
        criteria: [
          {
            id: 'climate',
            ratings: [{ region: 'QM-09', stars: 3, value: '1', source: 'synthetic' }],
          },
        ],
      },
    ],
    [
      'a source it does not list',
      {
        ...regionFile,
        criteria: [
          { id: 'climate', ratings: [{ region: 'QM-01', stars: 3, value: '1', source: 'other' }] },
        ],
      },
    ],
    ['a region listed twice', { ...regionFile, regions: ['QM-01', 'QM-01'] }],
    ['a code that is not ISO 3166-2', { ...regionFile, regions: ['QM01'] }],
  ])('refuses %s', (_, candidate) => {
    expect(regionRatingsSchema.safeParse(candidate).success).toBe(false);
  });

  it('lists a country’s regions in code order', () => {
    expect(regions.regionsOf('QM')).toEqual(['QM-01', 'QM-02', 'QM-03']);
    expect(regions.regionsOf('QN')).toEqual([]);
  });

  it('takes a country or a region as a place a person rates', () => {
    expect(placeCodeSchema.safeParse('PT').success).toBe(true);
    expect(placeCodeSchema.safeParse('PT-20').success).toBe(true);
    expect(placeCodeSchema.safeParse('US-TX').success).toBe(true);
    expect(placeCodeSchema.safeParse('pt-20').success).toBe(false);
  });
});

describe('regions in the comparison (ADR-0042)', () => {
  const compare = (overrides: Parameters<typeof preferences>[0] = {}) =>
    compareDestinations({
      entry: entry(
        [personalCriterion('climate', 2), indicatorCriterion('cost', 'price-level', '200', '0', 1)],
        [decimalIndicator('price-level', [['QM', '80']])],
      ),
      preferences: preferences(overrides),
      countries: ['QM', 'QN'],
      today,
      suggestions,
      regions,
    });
  const qm = (overrides: Parameters<typeof preferences>[0] = {}) =>
    compare(overrides).countries.find(({ country }) => country === 'QM');

  it('ranks the regions by their own data and inherits what they lack', () => {
    const result = qm();
    expect(result?.regions.map(({ region, rank }) => [region, rank])).toEqual([
      ['QM-01', 1],
      ['QM-03', 2],
      ['QM-02', 3],
    ]);
    const first = result?.regions[0];
    expect(first?.scores[0]).toMatchObject({
      criterion: 'climate',
      score: '10',
      suggested: { stars: 5 },
    });
    expect(first?.scores[0]?.inherited).toBeUndefined();
    // The indicator reads country data only, so every region takes the country's score.
    expect(first?.scores[1]).toEqual({
      criterion: 'cost',
      score: result?.scores[1]?.score,
      inherited: true,
    });
    // No regional climate: the country's suggested 3 stars (5) count, and say which stars they are.
    const third = result?.regions.find(({ region }) => region === 'QM-03');
    expect(third?.scores[0]).toEqual({
      criterion: 'climate',
      score: '5',
      inherited: true,
      countryStars: 3,
    });
  });

  it('lets the person’s stars for a region win over its data', () => {
    const result = qm({ ratings: { climate: { 'QM-02': 5 } } });
    const region = result?.regions.find(({ region: code }) => code === 'QM-02');
    expect(region?.scores[0]).toMatchObject({ score: '10', rating: 5, suggested: { stars: 1 } });
    // Tied with QM-01, which comes first by code.
    expect([region?.total, region?.rank]).toEqual([result?.regions[0]?.total, 2]);
  });

  // Confirming a country's suggestion stores it as the person's stars, so if those beat the region's
  // data, one tap would flatten every region of the country on that criterion.
  it('lets a region’s data win over the person’s stars for the country', () => {
    const result = qm({ ratings: { climate: { QM: 5 } } });
    expect(result?.regions.find(({ region }) => region === 'QM-02')?.scores[0]?.score).toBe('0');
    expect(result?.regions.find(({ region }) => region === 'QM-03')?.scores[0]).toEqual({
      criterion: 'climate',
      score: '10',
      inherited: true,
      countryStars: 5,
    });
  });

  it('gives a country without regional data no regions', () => {
    expect(compare().countries.find(({ country }) => country === 'QN')?.regions).toEqual([]);
  });

  it('gives no regions when none are given', () => {
    const result = compareDestinations({
      entry: entry([personalCriterion('climate')], []),
      preferences: preferences(),
      countries: ['QM'],
      today,
    });
    expect(result.countries[0]?.regions).toEqual([]);
  });
});
