import { describe, expect, it } from 'vitest';
import { checkComparisonVersion, checkCountryIndicator } from '../../src/comparison/check.js';
import {
  type ComparisonCriterion,
  type CountryIndicator,
  comparisonPreferencesSchema,
  comparisonVersionSchema,
  countryIndicatorSchema,
  maxCriterionKeys,
  maxRatings,
} from '../../src/comparison/schema.js';
import type { OfficialHosts } from '../../src/rules/validate.js';
import {
  decimalIndicator,
  entry,
  freshSource,
  indicatorCriterion,
  personalCriterion,
  tokenIndicator,
} from './fixtures.js';

const official: OfficialHosts = {
  hosts: ['data.fixture.example'],
  hostOf: (url) => /^https:\/\/([^/]+)/.exec(url)?.[1],
};
const countries = new Set(['QM', 'QN']);

const messages = (issues: readonly { message: string }[]) => issues.map((each) => each.message);

describe('country indicator checks (ADR-0026)', () => {
  it('accepts a valid indicator', () => {
    const indicator = decimalIndicator('homicides', [
      ['QM', '1.25'],
      ['QN', '0'],
    ]);
    expect(countryIndicatorSchema.safeParse(indicator).success).toBe(true);
    expect(checkCountryIndicator(indicator, official, countries)).toEqual([]);
  });

  it.each<[string, CountryIndicator, string]>([
    [
      'a float-looking value that is no decimal',
      decimalIndicator('x', [['QM', '1e3']]),
      'A value is a decimal',
    ],
    [
      'a token in a decimal indicator',
      decimalIndicator('x', [['QM', 'high']]),
      'A value is a decimal',
    ],
    ['a decimal in a token indicator', tokenIndicator('x', [['QM', '1.5']]), 'A value is a token'],
    [
      'a country outside the pinned file',
      decimalIndicator('x', [['QZ', '1']]),
      'The country is in the pinned countries file',
    ],
    [
      'a country twice',
      decimalIndicator('x', [
        ['QM', '1'],
        ['QM', '2'],
      ]),
      'A country has one value',
    ],
    [
      'a value citing no source of the file',
      {
        ...decimalIndicator('x', []),
        values: [{ country: 'QM', value: '1', year: 2024, source: 'nowhere' }],
      },
      'A value cites one of the sources',
    ],
    [
      'an official source off the pinned hosts',
      {
        ...decimalIndicator('x', []),
        sources: [{ ...freshSource, url: 'https://evil.example/data' }],
      },
      'An official source is on a pinned official host',
    ],
    [
      'a secondary source',
      {
        ...decimalIndicator('x', []),
        sources: [{ ...freshSource, kind: 'secondary' }],
      },
      'An indicator cites official sources only',
    ],
  ])('rejects %s', (_name, indicator, message) => {
    expect(messages(checkCountryIndicator(indicator, official, countries))).toContain(message);
  });
});

describe('comparison version checks', () => {
  const homicides = decimalIndicator('homicides', [['QM', '1']]);
  const dual = tokenIndicator('dual', [
    ['QM', 'allowed'],
    ['QN', 'restricted'],
  ]);
  const category = (
    scores: readonly [string, number][],
    indicator = 'dual',
  ): ComparisonCriterion => ({
    id: 'dual-citizenship',
    title: 'Dual citizenship',
    kind: 'category',
    indicator,
    defaultWeight: 2,
    scores: scores.map(([token, score]) => ({ token, score })),
  });
  const check = (
    criteria: readonly ComparisonCriterion[],
    indicators: readonly CountryIndicator[],
  ) => {
    const { version } = entry(criteria, indicators);
    return messages(
      checkComparisonVersion(version, new Map(indicators.map((each) => [each.id, each]))),
    );
  };

  it('accepts a valid version', () => {
    const criteria = [
      indicatorCriterion('safety', 'homicides', '20', '0'),
      category([
        ['allowed', 10],
        ['restricted', 5],
      ]),
      personalCriterion('climate'),
    ];
    const { version } = entry(criteria, [homicides, dual]);
    expect(comparisonVersionSchema.safeParse(version).success).toBe(true);
    expect(check(criteria, [homicides, dual])).toEqual([]);
  });

  it.each<[string, readonly ComparisonCriterion[], readonly CountryIndicator[], string]>([
    [
      'equal anchors',
      [indicatorCriterion('safety', 'homicides', '5', '5.0')],
      [homicides],
      'The anchors differ',
    ],
    [
      'an unpinned indicator',
      [indicatorCriterion('safety', 'missing', '0', '1')],
      [],
      'The criterion reads a pinned indicator',
    ],
    [
      'an indicator criterion on tokens',
      [indicatorCriterion('safety', 'dual', '0', '1')],
      [dual],
      'An indicator criterion reads a decimal indicator',
    ],
    [
      'a category on decimals',
      [category([['allowed', 10]], 'homicides')],
      [homicides],
      'A category criterion reads a token indicator',
    ],
    [
      'a token without a score',
      [category([['allowed', 10]])],
      [dual],
      'The token restricted has a score',
    ],
    [
      'a token scored twice',
      [
        category([
          ['allowed', 10],
          ['allowed', 3],
          ['restricted', 1],
        ]),
      ],
      [dual],
      'Each token is scored once',
    ],
    [
      'a duplicate criterion',
      [personalCriterion('climate'), personalCriterion('climate')],
      [],
      'Criterion IDs are unique',
    ],
    [
      'a pinned indicator no criterion reads',
      [personalCriterion('climate')],
      [homicides],
      'Every pinned indicator is read',
    ],
  ])('rejects %s', (_name, criteria, indicators, message) => {
    expect(check(criteria, indicators)).toContain(message);
  });

  it('reports a token without a score once, however many countries have it', () => {
    const shared = tokenIndicator('dual', [
      ['QM', 'restricted'],
      ['QN', 'restricted'],
    ]);
    expect(
      check([category([['allowed', 10]])], [shared]).filter(
        (message) => message === 'The token restricted has a score',
      ),
    ).toHaveLength(1);
  });

  it('keeps the own- prefix for criteria a person creates', () => {
    const { version } = entry([personalCriterion('own-climate')], []);
    expect(comparisonVersionSchema.safeParse(version).success).toBe(false);
  });
});

describe('comparison preferences', () => {
  const parse = (value: unknown) => comparisonPreferencesSchema.safeParse(value).success;
  const base = { weights: {}, ratings: {}, ownCriteria: [], hidden: [] };

  it.each<[string, unknown, boolean]>([
    ['empty', base, true],
    ['a weight of 5', { ...base, weights: { safety: 5 } }, true],
    ['a weight of 6', { ...base, weights: { safety: 6 } }, false],
    ['a fractional weight', { ...base, weights: { safety: 2.5 } }, false],
    ['a rating of 0', { ...base, ratings: { climate: { PT: 0 } } }, false],
    ['a rating of 5', { ...base, ratings: { climate: { PT: 5 } } }, true],
    ['a lowercase country', { ...base, ratings: { climate: { pt: 3 } } }, false],
    ['an own criterion', { ...base, ownCriteria: [{ id: 'own-0123abcd', name: 'Praia' }] }, true],
    [
      'an own criterion with a slug ID',
      { ...base, ownCriteria: [{ id: 'beach', name: 'Praia' }] },
      false,
    ],
    ['an empty name', { ...base, ownCriteria: [{ id: 'own-0123abcd', name: '   ' }] }, false],
    [
      'a name over 60 characters',
      { ...base, ownCriteria: [{ id: 'own-0123abcd', name: 'a'.repeat(61) }] },
      false,
    ],
    [
      'a name with a control character',
      { ...base, ownCriteria: [{ id: 'own-0123abcd', name: 'a\u0007b' }] },
      false,
    ],
    [
      'a name with an invisible character',
      { ...base, ownCriteria: [{ id: 'own-0123abcd', name: 'Pra\u200bia' }] },
      false,
    ],
    [
      'a name not in NFC',
      { ...base, ownCriteria: [{ id: 'own-0123abcd', name: 'Sa\u0303o Paulo' }] },
      false,
    ],
    ['a criterion with no ratings', { ...base, ratings: { climate: {} } }, false],
    [
      'the same own ID twice',
      {
        ...base,
        ownCriteria: [
          { id: 'own-0123abcd', name: 'A' },
          { id: 'own-0123abcd', name: 'B' },
        ],
      },
      false,
    ],
    ['a country hidden twice', { ...base, hidden: ['PT', 'PT'] }, false],
    ['an unknown key', { ...base, extra: true }, false],
  ])('%s', (_name, value, valid) => {
    expect(parse(value)).toBe(valid);
  });

  it('never carries a prototype key into the result', () => {
    const parsed = comparisonPreferencesSchema.safeParse(
      JSON.parse('{"weights":{"__proto__":1},"ratings":{},"ownCriteria":[],"hidden":[]}'),
    );
    expect(parsed.success && Object.keys(parsed.data.weights)).toEqual([]);
    expect(Object.getPrototypeOf(parsed.data?.weights)).toBe(Object.prototype);
  });

  it('caps the weights, the rated criteria and the ratings', () => {
    const keys = (count: number) =>
      Array.from({ length: count }, (_, index) => `c${String(index)}`);
    const countryCodes = (count: number) =>
      Array.from({ length: count }, (_, index) => `A${String.fromCharCode(65 + index)}`);
    const ratings = (criteria: number, perCriterion: number) =>
      Object.fromEntries(
        keys(criteria).map((key) => [
          key,
          Object.fromEntries(countryCodes(perCriterion).map((code) => [code, 3])),
        ]),
      );
    const weights = (count: number) => Object.fromEntries(keys(count).map((key) => [key, 3]));
    const perCriterion = maxRatings / maxCriterionKeys;

    expect(parse({ ...base, weights: weights(maxCriterionKeys) })).toBe(true);
    expect(parse({ ...base, weights: weights(maxCriterionKeys + 1) })).toBe(false);
    expect(parse({ ...base, ratings: ratings(maxCriterionKeys + 1, 1) })).toBe(false);
    expect(parse({ ...base, ratings: ratings(maxCriterionKeys, perCriterion) })).toBe(true);
    expect(parse({ ...base, ratings: ratings(maxCriterionKeys, perCriterion + 1) })).toBe(false);
  });
});
