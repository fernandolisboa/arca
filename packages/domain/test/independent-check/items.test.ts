import { describe, expect, it } from 'vitest';
import {
  checkItems,
  expressionValues,
  machineReadableUrls,
} from '../../src/independent-check/items.js';
import type { Expression } from '../../src/rules/expression.js';
import { countrySetSchema, routeVersionSchema } from '../../src/rules/route-version.js';
import { entry, treaty } from '../rules/fixtures.js';

const secondary = {
  id: 'blog',
  url: 'https://blog.example/post',
  title: 'A blog post',
  kind: 'secondary',
  verifiedAt: '2026-10-01',
};

describe('checkItems', () => {
  it('lists every requirement, assessment, dependent rule, cost, duration, the leap-day rule and each country set, by stable key', () => {
    expect(checkItems(entry()).map((item) => item.key)).toEqual([
      'requirement:adult',
      'requirement:means',
      'dependent:spouse',
      'dependent:children',
      'dependent:parents',
      'cost:fee',
      'cost:dependent-fee',
      'duration:decision',
      'leapDayBirthday',
      'countrySet:treaty/2',
    ]);
  });

  it('gives each item the values it states, money in its currency units', () => {
    const values = Object.fromEntries(
      checkItems(entry()).map((item) => [item.key, item.values.map(({ value }) => value)]),
    );
    expect(values).toMatchObject({
      'requirement:adult': ['18'],
      'requirement:means': ['1000', '500'],
      'dependent:spouse': [],
      'dependent:children': ['21'],
      'cost:fee': ['100'],
      'duration:decision': ['2', '6'],
      leapDayBirthday: [],
      'countrySet:treaty/2': [],
    });
  });

  it('reads only official sources, and a country set on its own sources and lists', () => {
    const items = checkItems(
      entry({
        sources: [entry().version.sources[0], secondary],
        requirements: [{ ...entry().version.requirements[0], sources: ['law', 'blog'] }],
      }),
    );
    expect(items[0]?.urls).toEqual(['https://www.gov.example/law']);
    expect(items[0]?.officialDomains).toEqual([{ id: 'qm-gov', number: 1 }]);
    const set = items.find((item) => item.kind === 'countrySet');
    expect(set?.urls).toEqual(['https://www.gov.example/law']);
    expect(set?.officialDomains).toEqual([{ id: 'qm-gov', number: 1 }]);
  });

  it('lists the closure of a closed version and nothing it does not have', () => {
    const closed = entry({
      status: 'closed',
      closureSources: ['law'],
      leapDayBirthday: undefined,
      leapDayBirthdaySources: undefined,
      requirements: [],
      dependents: [],
      costs: [],
      durations: [],
    });
    expect(checkItems({ ...closed, countrySets: [] }).map((item) => item.key)).toEqual(['closure']);
  });

  it('covers every field of a version that cites sources', () => {
    const shape = routeVersionSchema.shape;
    const sourced = Object.entries(shape)
      .filter(([field, schema]) => {
        const json = JSON.stringify(schema.toJSONSchema({ unrepresentable: 'any' }));
        return field.endsWith('Sources') || json.includes('"sources"');
      })
      .map(([field]) => field)
      .sort();
    // `sources` itself is the list items point into; `countrySets` pins sets that carry sources.
    expect(sourced).toEqual(
      [
        'assessments',
        'closureSources',
        'costs',
        'dependents',
        'durations',
        'leapDayBirthdaySources',
        'requirements',
      ].sort(),
    );
  });
});

describe('expressionValues', () => {
  const fact = { op: 'fact', key: 'person.ageYears' } as const;
  it.each<[string, Expression, string[]]>([
    ['an age limit', { op: 'lt', left: fact, right: { op: 'int', value: 21 } }, ['21']],
    ['no structural 0 or 1', { op: 'gte', left: fact, right: { op: 'int', value: 1 } }, []],
    ['a decimal', { op: 'gte', left: fact, right: { op: 'decimal', value: '2.50' } }, ['2.5']],
    [
      'a multiplier',
      { op: 'mul', operand: { op: 'money', amount: 92000, currency: 'EUR' }, by: '1.5' },
      ['1.5', '920'],
    ],
    [
      'a duration',
      { op: 'since', date: { op: 'fact', key: 'person.birthDate' }, duration: 'P2Y6M' },
      ['2', '6'],
    ],
    [
      'no duration of one year',
      { op: 'since', date: { op: 'fact', key: 'person.birthDate' }, duration: 'P1Y' },
      [],
    ],
    [
      'a date',
      { op: 'gte', left: fact, right: { op: 'date', value: '2012-01-01' } },
      ['2012-01-01'],
    ],
    [
      'a repeat once',
      {
        op: 'any',
        operands: [
          { op: 'gt', left: fact, right: { op: 'int', value: 21 } },
          { op: 'lt', left: fact, right: { op: 'int', value: 21 } },
        ],
      },
      ['21'],
    ],
  ])('%s', (_, expression, expected) => {
    expect(expressionValues(expression).map(({ value }) => value)).toEqual(expected);
  });
});

describe('machineReadableUrls', () => {
  const law = 'https://www.gov.example/law';
  const data = 'https://api.gov.example/law.json';
  const lawSource = {
    id: 'law',
    url: law,
    title: 'Residence act',
    kind: 'official' as const,
    verifiedAt: '2026-10-01',
  };
  const naming = (address: string | undefined) =>
    address === undefined ? lawSource : { ...lawSource, machineReadableUrl: address };
  const withSources = (versionAddress?: string, setAddress?: string) => ({
    ...entry({ sources: [naming(versionAddress)] }),
    countrySets: [countrySetSchema.parse({ ...treaty, sources: [naming(setAddress)] })],
  });

  it.each([
    ['every official source at it names it', data, data],
    ['the country set names none', data, undefined],
    ['the version names none', undefined, data],
  ])('reads a URL through its address when %s', (_, versionAddress, setAddress) => {
    expect([...machineReadableUrls(withSources(versionAddress, setAddress))]).toEqual([
      [law, data],
    ]);
  });

  it.each([
    ['no source names one', undefined, undefined],
    ['the sources name different ones', data, 'https://api.gov.example/other.json'],
  ])('reads the page itself when %s', (_, versionAddress, setAddress) => {
    expect(machineReadableUrls(withSources(versionAddress, setAddress)).size).toBe(0);
  });

  it('never takes an address from a secondary source', () => {
    const secondaryWithAddress = { ...secondary, machineReadableUrl: data };
    const read = machineReadableUrls({
      ...entry({ sources: [lawSource, secondaryWithAddress] }),
      countrySets: [],
    });
    expect(read.size).toBe(0);
  });
});
