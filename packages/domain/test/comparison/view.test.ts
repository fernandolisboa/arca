import { describe, expect, it } from 'vitest';
import type { ComparisonEntry } from '../../src/comparison/select.js';
import { comparisonIdentityKey } from '../../src/comparison/select.js';
import { comparisonVersionView } from '../../src/comparison/view.js';
import type { DecisionState } from '../../src/rules/catalog.js';
import {
  decimalIndicator,
  entry,
  freshSource,
  oldSource,
  indicatorCriterion,
  personalCriterion,
} from './fixtures.js';

const hostOf = (url: string) => /^https:\/\/([a-z.]+)\//.exec(url)?.[1];

function numbered(number: number, base: ComparisonEntry): ComparisonEntry {
  return {
    ...base,
    identity: { ...base.identity, number, hash: String(number).repeat(64) },
    version: { ...base.version, number },
  };
}

const homicides = decimalIndicator('homicides', [
  ['QM', '1.5'],
  ['QN', '4'],
]);

const first = numbered(
  1,
  entry(
    [indicatorCriterion('safety', 'homicides', '20', '0.5'), personalCriterion('climate')],
    [homicides],
  ),
);

const second = numbered(
  2,
  entry(
    [indicatorCriterion('safety', 'homicides', '20', '0.5', 4), personalCriterion('schools')],
    [
      {
        ...decimalIndicator('homicides', [
          ['QM', '1.5'],
          ['QO', '2'],
        ]),
        number: 2,
      },
    ],
  ),
);

const statesOf = (decided: readonly (readonly [ComparisonEntry, DecisionState])[]) =>
  new Map(decided.map(([each, state]) => [comparisonIdentityKey(each.identity), state]));

describe('comparison version view (ADR-0026)', () => {
  it('lays out the criteria and every value with its year, source and host', () => {
    const view = comparisonVersionView({
      entries: [first],
      number: 1,
      states: new Map(),
      hostOf,
    });
    expect(view).toMatchObject({
      comparisonId: 'destinations',
      number: 1,
      hash: '1'.repeat(64),
      state: 'proposed',
      criteria: first.version.criteria,
      replaces: null,
      rejection: { selected: false, fallback: null },
    });
    expect(view?.indicators).toEqual([
      expect.objectContaining({
        id: 'homicides',
        number: 1,
        unit: 'per 100,000 people',
        sources: [
          { ...freshSource, host: 'data.fixture.example' },
          { ...oldSource, host: 'data.fixture.example' },
        ],
        values: [
          {
            country: 'QM',
            value: '1.5',
            year: 2024,
            source: 'fresh',
            host: 'data.fixture.example',
            previous: null,
          },
          {
            country: 'QN',
            value: '4',
            year: 2024,
            source: 'fresh',
            host: 'data.fixture.example',
            previous: null,
          },
        ],
        removed: [],
      }),
    ]);
  });

  it('shows what changed from the version before, value by value', () => {
    const view = comparisonVersionView({
      entries: [first, second],
      number: 2,
      states: statesOf([[first, 'active']]),
      hostOf,
    });
    expect(view?.replaces).toEqual({
      number: 1,
      criteria: { added: ['schools'], removed: ['climate'], changed: ['safety'] },
      indicators: { added: [], removed: [], changed: ['homicides'] },
    });
    const [homicides] = view?.indicators ?? [];
    expect(homicides?.values.map(({ country, previous }) => [country, previous])).toEqual([
      ['QM', { value: '1.5', year: 2024 }],
      ['QO', null],
    ]);
    expect(homicides?.removed).toEqual(['QN']);
  });

  it('shows no indicator change when only its number moved', () => {
    const renumbered = numbered(2, {
      ...first,
      indicators: [{ ...homicides, number: 2 }],
    });
    expect(
      comparisonVersionView({ entries: [first, renumbered], number: 2, states: new Map(), hostOf })
        ?.replaces?.indicators,
    ).toEqual({ added: [], removed: [], changed: [] });
  });

  it.each<
    [string, readonly (readonly [ComparisonEntry, DecisionState])[], number, boolean, number | null]
  >([
    [
      'the active version falls back to the one before',
      [
        [first, 'active'],
        [second, 'active'],
      ],
      2,
      true,
      1,
    ],
    ['the only active version leaves nothing in use', [[first, 'active']], 1, true, null],
    ['a proposed newer version changes nothing in use', [[first, 'active']], 2, false, 1],
    [
      'an older active version is not the one in use',
      [
        [first, 'active'],
        [second, 'active'],
      ],
      1,
      false,
      2,
    ],
  ])('rejection: %s', (_name, decided, number, selected, fallback) => {
    expect(
      comparisonVersionView({ entries: [first, second], number, states: statesOf(decided), hostOf })
        ?.rejection,
    ).toEqual({ selected, fallback: fallback === null ? null : { number: fallback } });
  });

  it('marks a source URL with no plain host', () => {
    const odd = {
      ...first,
      indicators: [
        {
          ...homicides,
          sources: [{ ...freshSource, url: 'https://user@data.fixture.example/x' }],
        },
      ],
    };
    const view = comparisonVersionView({
      entries: [odd],
      number: 1,
      states: new Map(),
      hostOf: () => undefined,
    });
    expect(view?.indicators[0]?.values[0]?.host).toBeNull();
    expect(view?.indicators[0]?.sources[0]?.host).toBeNull();
  });

  it('answers nothing for a number the catalog does not hold', () => {
    expect(
      comparisonVersionView({ entries: [first], number: 3, states: new Map(), hostOf }),
    ).toBeUndefined();
  });
});
