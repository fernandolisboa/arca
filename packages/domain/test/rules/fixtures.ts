import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import { fxTableSchema } from '../../src/money/fx.js';
import { type CatalogEntry, identityKey } from '../../src/rules/catalog.js';
import type { EvaluationContext } from '../../src/rules/context.js';
import { countrySetSchema, routeVersionSchema } from '../../src/rules/route-version.js';

/** Synthetic knowledge only: an invented country code, hosts, amounts and rules. */
const source = {
  id: 'law',
  url: 'https://www.gov.example/law',
  title: 'Residence act',
  kind: 'official',
  verifiedAt: '2026-10-01',
};

const fact = (key: string, extra: object = {}): object => ({ op: 'fact', key, ...extra });
const int = (value: number): object => ({ op: 'int', value });
const euros = (amount: number): object => ({ op: 'money', amount, currency: 'EUR' });

/** Spouse and children under 21 (an EB-5-like shape), dependent parents, and a means test. */
export const sampleVersion = {
  schemaVersion: 1,
  routeId: 'qm-sample',
  number: 1,
  title: 'Sample residence route',
  country: 'QM',
  tags: ['retirement'],
  effectiveFrom: '2020-01-01',
  status: 'open',
  currency: 'EUR',
  leapDayBirthday: 'feb-28',
  leapDayBirthdaySources: ['law'],
  sources: [source],
  countries: { id: 'countries', number: 1 },
  formerCountries: { id: 'former-countries', number: 1 },
  countrySets: [{ id: 'treaty', number: 2 }],
  officialDomains: [{ id: 'qm-gov', number: 1 }],
  requirements: [
    {
      id: 'adult',
      title: 'The principal is an adult',
      expression: { op: 'gte', left: fact('principal.ageYears'), right: int(18) },
      sources: ['law'],
    },
    {
      id: 'means',
      title: 'Means of subsistence',
      expression: {
        op: 'gte',
        left: fact('unit.liquidAssets'),
        right: {
          op: 'add',
          left: euros(1000_00),
          right: { op: 'sum', over: 'unit.dependents', value: euros(500_00) },
        },
      },
      sources: ['law'],
    },
  ],
  assessments: [],
  dependents: [
    {
      id: 'spouse',
      title: 'Spouse',
      path: ['spouse'],
      condition: { op: 'bool', value: true },
      sources: ['law'],
    },
    {
      id: 'children',
      title: 'Unmarried children under 21',
      path: ['child'],
      condition: {
        op: 'all',
        operands: [
          { op: 'lt', left: fact('person.ageYears'), right: int(21) },
          { op: 'not', operand: fact('person.hasSpouse') },
        ],
      },
      sources: ['law'],
    },
    {
      id: 'parents',
      title: 'Dependent parents',
      path: ['parent'],
      condition: fact('person.dependsOnPrincipal'),
      sources: ['law'],
    },
  ],
  costs: [
    {
      id: 'fee',
      title: 'Application fee',
      kind: 'fee',
      amount: euros(100_00),
      appliesTo: 'principal',
      sources: ['law'],
    },
    {
      id: 'dependent-fee',
      title: 'Dependent fee',
      kind: 'fee',
      amount: euros(50_00),
      appliesTo: 'each_dependent',
      sources: ['law'],
    },
  ],
  durations: [{ id: 'decision', title: 'To a decision', min: 'P2M', max: 'P6M', sources: ['law'] }],
};

export const treaty = countrySetSchema.parse({
  schemaVersion: 1,
  id: 'treaty',
  number: 2,
  title: 'Treaty countries',
  members: ['QM', 'QN'],
  sources: [source],
  countries: { id: 'countries', number: 1 },
  formerCountries: { id: 'former-countries', number: 1 },
  officialDomains: [{ id: 'qm-gov', number: 1 }],
});

export function entry(patch: object = {}): CatalogEntry {
  const version = routeVersionSchema.parse({ ...sampleVersion, ...patch });
  return {
    identity: {
      routeId: version.routeId,
      number: version.number,
      effectiveFrom: version.effectiveFrom,
      ...(version.corrects === undefined ? {} : { corrects: version.corrects }),
      status: version.status,
      hash: `hash-${String(version.number)}`,
    },
    version,
    countrySets: [treaty],
  };
}

export function context(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    rulesAsOf: parseCalendarDate('2026-11-03'),
    today: parseCalendarDate('2026-11-03'),
    fx: fxTableSchema.parse({
      rates: [{ from: 'USD', to: 'EUR', rate: '0.5', date: '2026-11-01', source: 'fixture' }],
    }),
    states: new Map([[identityKey(entry().identity), 'active']]),
    engineCommit: 'test',
    ...overrides,
  };
}
