import { describe, expect, it } from 'vitest';
import {
  type RouteVersion,
  routeVersionJsonSchema,
  countrySetSchema,
  jsonDepthWithin,
  routeVersionSchema,
} from '../../src/rules/route-version.js';
import {
  type OfficialHosts,
  checkCountrySet,
  checkRouteVersion,
  hostMatches,
} from '../../src/rules/validate.js';

/** A synthetic route version: invented country code, hosts and amounts. */
const valid = {
  schemaVersion: 1,
  routeId: 'qm-sample',
  number: 1,
  title: 'Sample residence route',
  country: 'QM',
  tags: ['retirement'],
  effectiveFrom: '2026-01-01',
  status: 'open',
  currency: 'EUR',
  leapDayBirthday: 'feb-28',
  leapDayBirthdaySources: ['law'],
  sources: [
    {
      id: 'law',
      url: 'https://www.gov.example/law',
      title: 'Residence act',
      kind: 'official',
      verifiedAt: '2026-10-01',
    },
    {
      id: 'blog',
      url: 'https://blog.example/post',
      title: 'Explainer',
      kind: 'secondary',
      verifiedAt: '2026-10-01',
    },
  ],
  countries: { id: 'countries', number: 1 },
  formerCountries: { id: 'former-countries', number: 1 },
  countrySets: [{ id: 'treaty', number: 2 }],
  officialDomains: [{ id: 'qm-gov', number: 1 }],
  requirements: [
    {
      id: 'adult',
      title: 'The principal is an adult',
      expression: {
        op: 'gte',
        left: { op: 'fact', key: 'principal.ageYears' },
        right: { op: 'int', value: 18 },
      },
      sources: ['law', 'blog'],
    },
    {
      id: 'means',
      title: 'Means of subsistence',
      expression: {
        op: 'gte',
        left: { op: 'fact', key: 'unit.liquidAssets' },
        right: {
          op: 'add',
          left: { op: 'money', amount: 870_00, currency: 'EUR' },
          right: {
            op: 'sum',
            over: 'unit.dependents',
            value: { op: 'money', amount: 435_00, currency: 'EUR' },
          },
        },
      },
      sources: ['law'],
    },
  ],
  assessments: [
    {
      id: 'ties',
      title: 'Ties to the country',
      evidence: ['principal.residenceCountry'],
      sources: ['law'],
    },
  ],
  dependents: [
    {
      id: 'children',
      title: 'Children under 18',
      path: ['child'],
      condition: {
        op: 'lt',
        left: { op: 'fact', key: 'person.ageYears' },
        right: { op: 'int', value: 18 },
      },
      sources: ['law'],
    },
  ],
  costs: [
    {
      id: 'fee',
      title: 'Application fee',
      kind: 'fee',
      amount: { op: 'money', amount: 90_00, currency: 'EUR' },
      appliesTo: 'each_dependent',
      sources: ['law'],
    },
  ],
  durations: [{ id: 'decision', title: 'To a decision', min: 'P2M', max: 'P6M', sources: ['law'] }],
};

const official: OfficialHosts = {
  hosts: ['gov.example'],
  hostOf: (url) => /^https:\/\/([a-z0-9.-]+)\//.exec(url)?.[1],
};

function issues(patch: object): string[] {
  const version: RouteVersion = routeVersionSchema.parse({ ...valid, ...patch });
  return checkRouteVersion(version, official).map((issue) => `${issue.path}: ${issue.message}`);
}

describe('route version', () => {
  it('accepts a valid synthetic version', () => {
    expect(issues({})).toEqual([]);
  });

  it.each([
    ['a wrong schema version', { schemaVersion: 2 }],
    ['a route ID without a country', { routeId: 'sample' }],
    ['a correction of a later version', { number: 2, corrects: 3 }],
    ['a free-text cost kind', { costs: [{ ...valid.costs[0], kind: 'Fee!' }] }],
    [
      'a plain-http source',
      { sources: [{ ...valid.sources[0], url: 'http://www.gov.example/law' }] },
    ],
  ])('rejects %s in the schema', (_label, patch) => {
    expect(routeVersionSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it.each<[string, object, string]>([
    ['a country mismatch', { routeId: 'qn-sample' }, '/routeId'],
    [
      'duplicate requirement IDs',
      { requirements: [valid.requirements[0], valid.requirements[0]] },
      '/requirements',
    ],
    [
      'an official source on another host',
      { sources: [{ ...valid.sources[0], url: 'https://evil-gov.example/law' }, valid.sources[1]] },
      '/sources/0',
    ],
    [
      'a rule citing only a secondary source',
      { requirements: [{ ...valid.requirements[0], sources: ['blog'] }] },
      '/requirements/0/sources',
    ],
    [
      'a rule citing a missing source',
      { requirements: [{ ...valid.requirements[0], sources: ['law', 'nope'] }] },
      '/requirements/0/sources',
    ],
    [
      'an age without the leap-day convention',
      { leapDayBirthday: undefined, leapDayBirthdaySources: undefined },
      '/requirements/0/expression',
    ],
    [
      'a requirement that is not a condition',
      { requirements: [{ ...valid.requirements[0], expression: { op: 'int', value: 1 } }] },
      '/requirements/0/expression',
    ],
    [
      'a cost in another currency',
      { costs: [{ ...valid.costs[0], amount: { op: 'money', amount: 1, currency: 'USD' } }] },
      '/costs/0/amount',
    ],
    [
      'a dependent rule reading the unit',
      {
        dependents: [
          {
            ...valid.dependents[0],
            condition: {
              op: 'gte',
              left: { op: 'fact', key: 'unit.liquidAssets' },
              right: { op: 'money', amount: 1, currency: 'EUR' },
            },
          },
        ],
      },
      '/dependents/0/condition',
    ],
    [
      'a duration in two units',
      { durations: [{ ...valid.durations[0], max: 'P1Y' }] },
      '/durations/0',
    ],
    ['a reversed duration', { durations: [{ ...valid.durations[0], min: 'P7M' }] }, '/durations/0'],
    [
      'evidence on a candidate',
      { assessments: [{ ...valid.assessments[0], evidence: ['person.studying'] }] },
      '/assessments/0/evidence/0',
    ],
    [
      'evidence reading an age without the leap-day convention',
      {
        leapDayBirthday: undefined,
        leapDayBirthdaySources: undefined,
        requirements: [],
        dependents: [],
        assessments: [{ ...valid.assessments[0], evidence: ['principal.ageYears'] }],
      },
      '/assessments/0/evidence/0',
    ],
    ['an open version with closure sources', { closureSources: ['law'] }, '/closureSources'],
    [
      'a dependent rule at an undeclared date',
      { dependents: [{ ...valid.dependents[0], at: 'filingDate' }] },
      '/dependents/0/at',
    ],
    [
      'an unpinned set',
      {
        requirements: [
          {
            ...valid.requirements[0],
            expression: {
              op: 'in',
              item: { op: 'fact', key: 'principal.residenceCountry' },
              set: { op: 'set', id: 'other' },
            },
          },
        ],
      },
      '/requirements/0/expression',
    ],
  ])('reports %s', (_label, patch, path) => {
    expect(
      issues(patch).some((entry) => entry.startsWith(`${path}:`) || entry.startsWith(`${path}/`)),
    ).toBe(true);
  });

  it('accepts a closed version with official closure sources and no rules', () => {
    const closed = {
      status: 'closed',
      closureSources: ['law'],
      requirements: [],
      assessments: [],
      dependents: [],
      costs: [],
    };
    expect(issues(closed)).toEqual([]);
    expect(issues({ ...closed, closureSources: ['blog'] })).toEqual([
      '/closureSources: At least one cited source is official',
    ]);
    expect(issues({ ...closed, requirements: valid.requirements })).toContain(
      ': A closed version has no requirements, assessments, dependents or costs',
    );
  });

  it('exports a JSON Schema for editors', () => {
    const schema = routeVersionJsonSchema() as { type?: string; properties?: object };
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {})).toContain('requirements');
  });
});

describe('official hosts', () => {
  it.each([
    ['gov.example', true],
    ['www.gov.example', true],
    ['evil-gov.example', false],
    ['gov.example.evil', false],
  ])('%s', (host, expected) => {
    expect(hostMatches(host, ['gov.example'])).toBe(expected);
  });

  it("checks a country set's official sources", () => {
    const set = countrySetSchema.parse({
      schemaVersion: 1,
      id: 'treaty',
      number: 1,
      title: 'Treaty countries',
      members: ['QM', 'QN'],
      sources: [valid.sources[0]],
      countries: { id: 'countries', number: 1 },
      formerCountries: { id: 'former-countries', number: 1 },
      officialDomains: [{ id: 'qm-gov', number: 1 }],
    });
    expect(checkCountrySet(set, official)).toEqual([]);
    expect(checkCountrySet({ ...set, sources: [valid.sources[1]] } as never, official)).toEqual([
      { path: '/sources', message: 'At least one source is official' },
    ]);
  });
});

describe('jsonDepthWithin', () => {
  it('refuses very deep JSON without overflowing the stack', () => {
    let deep: object = { op: 'bool', value: true };
    for (let level = 0; level < 20_000; level += 1) deep = { op: 'not', operand: deep };
    expect(jsonDepthWithin(deep, 48)).toBe(false);
    expect(jsonDepthWithin(valid, 48)).toBe(true);
  });
});
