import { describe, expect, it } from 'vitest';
import {
  type ComparisonIdentity,
  type RouteStatus,
  bestRouteStatus,
  compareDestinations,
  comparisonIdentityKey,
  selectComparisonVersion,
} from '../../src/comparison/score.js';
import type { ComparisonCriterion } from '../../src/comparison/schema.js';
import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import { type DecisionState, identityKey } from '../../src/rules/catalog.js';
import {
  decimalIndicator,
  entry,
  indicatorCriterion,
  personalCriterion,
  preferences,
  tokenIndicator,
} from './fixtures.js';

const today = parseCalendarDate('2026-11-07');

function scoreOne(criterion: ComparisonCriterion, indicatorValue: string | undefined) {
  const indicators =
    criterion.kind === 'personal'
      ? []
      : [
          criterion.kind === 'category'
            ? tokenIndicator(
                'measure',
                indicatorValue === undefined ? [] : [['QM', indicatorValue]],
              )
            : decimalIndicator(
                'measure',
                indicatorValue === undefined ? [] : [['QM', indicatorValue]],
              ),
        ];
  const result = compareDestinations({
    entry: entry([criterion], indicators),
    preferences: preferences(),
    countries: ['QM'],
    today,
  });
  return result.countries[0]?.scores[0]?.score ?? null;
}

describe('indicator scores (ADR-0026)', () => {
  it.each([
    ['at the zero anchor', '50', '50', '90', '0'],
    ['at the ten anchor', '90', '50', '90', '10'],
    ['halfway', '70', '50', '90', '5'],
    ['below the zero anchor, clamped', '30', '50', '90', '0'],
    ['above the ten anchor, clamped', '100', '50', '90', '10'],
    ['lower is better, between', '5', '20', '0', '7.5'],
    ['lower is better, past the ten anchor', '0', '20', '1', '10'],
    ['lower is better, past the zero anchor', '25', '20', '0', '0'],
    ['a repeating fraction rounds to one place', '1', '0', '3', '3.3'],
    ['half rounds to even, down', '1', '0', '40', '0.2'],
    ['half rounds to even, up', '3', '0', '40', '0.8'],
    ['mixed scales', '0.375', '0.25', '1.5', '1'],
  ])('%s', (_name, value, zeroAt, tenAt, expected) => {
    expect(scoreOne(indicatorCriterion('measure', 'measure', zeroAt, tenAt), value)).toBe(expected);
  });

  it('is unknown, never zero, when the country has no value', () => {
    expect(scoreOne(indicatorCriterion('measure', 'measure', '0', '10'), undefined)).toBeNull();
  });
});

describe('category scores', () => {
  const category: ComparisonCriterion = {
    id: 'measure',
    title: 'Fixture category',
    kind: 'category',
    indicator: 'measure',
    defaultWeight: 3,
    scores: [
      { token: 'allowed', score: 10 },
      { token: 'restricted', score: 4 },
    ],
  };

  it.each([
    ['allowed', '10'],
    ['restricted', '4'],
  ])('scores %s', (token, expected) => {
    expect(scoreOne(category, token)).toBe(expected);
  });
});

describe('star ratings', () => {
  it.each([
    [1, '0'],
    [2, '2.5'],
    [3, '5'],
    [4, '7.5'],
    [5, '10'],
  ])('%d stars score %s', (stars, expected) => {
    const result = compareDestinations({
      entry: entry([personalCriterion('climate')], []),
      preferences: preferences({ ratings: { climate: { QM: stars } } }),
      countries: ['QM'],
      today,
    });
    expect(result.countries[0]?.scores[0]).toEqual({
      criterion: 'climate',
      score: expected,
      rating: stars,
    });
  });

  it('leaves an unrated criterion unknown', () => {
    const result = compareDestinations({
      entry: entry([personalCriterion('climate')], []),
      preferences: preferences(),
      countries: ['QM'],
      today,
    });
    expect(result.countries[0]?.scores[0]).toEqual({ criterion: 'climate', score: null });
  });
});

describe('totals, coverage and ranking', () => {
  const safety = decimalIndicator('homicides', [
    ['QM', '1'],
    ['QN', '11'],
    ['QP', '6', 'old'],
  ]);
  const criteria = [
    indicatorCriterion('safety', 'homicides', '21', '1', 4),
    personalCriterion('climate', 2),
  ];
  const summary = (result: ReturnType<typeof compareDestinations>) =>
    result.countries.map(({ country, rank, group, total, coverage }) => ({
      country,
      rank,
      group,
      total,
      coverage,
    }));

  it('weights the known scores, reports the weight they cover and breaks ties by code', () => {
    const result = compareDestinations({
      entry: entry(criteria, [safety]),
      preferences: preferences({ ratings: { climate: { QM: 1, QN: 5 } } }),
      countries: ['QN', 'QP', 'QM'],
      today,
    });
    expect(summary(result)).toEqual([
      // Safety 7.5 alone: climate is unrated, so 4 of the 6 weight is known.
      { country: 'QP', rank: 1, group: 'ranked', total: '7.5', coverage: 67 },
      // 10 × 4 + 0 × 2 and 5 × 4 + 10 × 2 are both 40 over 6: the code breaks the tie.
      { country: 'QM', rank: 2, group: 'ranked', total: '6.7', coverage: 100 },
      { country: 'QN', rank: 3, group: 'ranked', total: '6.7', coverage: 100 },
    ]);
  });

  it('breaks an equal total by coverage before the code', () => {
    const result = compareDestinations({
      entry: entry(criteria, [safety]),
      // QN: 5 × 4 + 5 × 2 = 30 over 6 = 5 with all weight known; QM gets 10 on safety only.
      preferences: preferences({ ratings: { climate: { QN: 3 } }, weights: { safety: 4 } }),
      countries: ['QM', 'QN'],
      today,
    });
    expect(summary(result).map(({ country }) => country)).toEqual(['QM', 'QN']);
    const tied = compareDestinations({
      entry: entry(
        [indicatorCriterion('safety', 'homicides', '21', '1', 2), personalCriterion('climate', 2)],
        [
          decimalIndicator('homicides', [
            ['QM', '11'],
            ['QN', '11'],
          ]),
        ],
      ),
      preferences: preferences({ ratings: { climate: { QN: 3 } } }),
      countries: ['QM', 'QN'],
      today,
    });
    // Both total 5; QN has all its weight known, QM half.
    expect(summary(tied)).toEqual([
      { country: 'QN', rank: 1, group: 'ranked', total: '5', coverage: 100 },
      { country: 'QM', rank: 2, group: 'ranked', total: '5', coverage: 50 },
    ]);
  });

  it('lists countries with less than half the weight known apart, without a rank', () => {
    const result = compareDestinations({
      entry: entry(
        [indicatorCriterion('safety', 'homicides', '21', '1', 1), personalCriterion('climate', 3)],
        [safety],
      ),
      preferences: preferences({ ratings: { climate: { QN: 2 } } }),
      countries: ['QM', 'QN', 'QR'],
      today,
    });
    expect(summary(result)).toEqual([
      { country: 'QN', rank: 1, group: 'ranked', total: '3.1', coverage: 100 },
      { country: 'QM', rank: null, group: 'few-data', total: '10', coverage: 25 },
      { country: 'QR', rank: null, group: 'few-data', total: null, coverage: 0 },
    ]);
  });

  it('leaves a criterion of weight 0 out of the total and the coverage', () => {
    const result = compareDestinations({
      entry: entry(criteria, [safety]),
      preferences: preferences({ weights: { climate: 0 } }),
      countries: ['QM'],
      today,
    });
    expect(summary(result)).toEqual([
      { country: 'QM', rank: 1, group: 'ranked', total: '10', coverage: 100 },
    ]);
  });

  it('ranks nothing when every weight is 0', () => {
    const result = compareDestinations({
      entry: entry(criteria, [safety]),
      preferences: preferences({ weights: { safety: 0, climate: 0 } }),
      countries: ['QM'],
      today,
    });
    expect(summary(result)).toEqual([
      { country: 'QM', rank: null, group: 'few-data', total: null, coverage: 0 },
    ]);
  });

  it('keeps hidden countries out of the ranking and lists them', () => {
    const result = compareDestinations({
      entry: entry(criteria, [safety]),
      preferences: preferences({ hidden: ['QN', 'QZ'] }),
      countries: ['QM', 'QN'],
      today,
    });
    expect(result.countries.map(({ country }) => country)).toEqual(['QM']);
    expect(result.hidden).toEqual(['QN']);
  });

  it('marks a reading whose source is older than 90 days', () => {
    const result = compareDestinations({
      entry: entry(criteria, [safety]),
      preferences: preferences(),
      countries: ['QM', 'QP'],
      today,
    });
    const reading = (country: string) =>
      result.countries.find((each) => each.country === country)?.scores[0]?.reading;
    expect(reading('QM')).toMatchObject({ value: '1', year: 2024, stale: false });
    expect(reading('QP')).toMatchObject({ value: '6', year: 2024, stale: true });
  });

  it('adds own criteria with their default weight and ignores entries for unknown criteria', () => {
    const result = compareDestinations({
      entry: entry([personalCriterion('climate', 0)], []),
      preferences: preferences({
        ownCriteria: [{ id: 'own-0000beef', name: 'Perto da praia' }],
        ratings: { 'own-0000beef': { QM: 5 }, 'gone-criterion': { QM: 1 } },
        weights: { 'gone-criterion': 5 },
      }),
      countries: ['QM'],
      today,
    });
    expect(result.criteria).toEqual([
      { id: 'climate', kind: 'personal', title: 'Fixture climate', weight: 0, defaultWeight: 0 },
      { id: 'own-0000beef', kind: 'own', name: 'Perto da praia', weight: 3, defaultWeight: 3 },
    ]);
    expect(summary(result)).toEqual([
      { country: 'QM', rank: 1, group: 'ranked', total: '10', coverage: 100 },
    ]);
  });
});

describe('comparison version selection', () => {
  const version = (number: number): ComparisonIdentity => ({
    comparisonId: 'destinations',
    number,
    hash: String(number).repeat(64),
  });
  const states = (decided: readonly (readonly [number, DecisionState])[]) =>
    new Map(decided.map(([number, state]) => [comparisonIdentityKey(version(number)), state]));

  it.each<[string, readonly (readonly [number, DecisionState])[], number | undefined, boolean]>([
    ['nothing decided', [], undefined, true],
    [
      'the newest active wins',
      [
        [1, 'active'],
        [2, 'active'],
      ],
      2,
      false,
    ],
    ['a newer proposed one is pending, not used', [[1, 'active']], 1, true],
    [
      'a rejected newer one is skipped for good',
      [
        [1, 'active'],
        [2, 'rejected'],
      ],
      1,
      false,
    ],
    ['an older proposed one is not pending', [[2, 'active']], 2, false],
    [
      'everything rejected',
      [
        [1, 'rejected'],
        [2, 'rejected'],
      ],
      undefined,
      false,
    ],
  ])('%s', (_name, decided, active, pendingNewer) => {
    const selection = selectComparisonVersion([version(1), version(2)], states(decided));
    expect(selection.active?.number).toBe(active);
    expect(selection.pendingNewer).toBe(pendingNewer);
  });

  it('never shares a key with a route version', () => {
    const identity = version(1);
    expect(comparisonIdentityKey(identity)).not.toBe(
      identityKey({ routeId: identity.comparisonId, number: 1, hash: identity.hash }),
    );
  });
});

describe('best route status', () => {
  it.each<[readonly RouteStatus[], RouteStatus | undefined]>([
    [[], undefined],
    [['not_eligible', 'missing_information'], 'missing_information'],
    [['pending_activation', 'not_eligible'], 'pending_activation'],
    [['unavailable', 'eligible', 'needs_assessment'], 'eligible'],
    [['unavailable'], 'unavailable'],
  ])('%j gives %s', (statuses, expected) => {
    expect(bestRouteStatus(statuses)).toBe(expected);
  });
});
