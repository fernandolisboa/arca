import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import { type DecisionState, identityKey } from '../../src/rules/catalog.js';
import { type RuleCaseSummary, versionView } from '../../src/rules/version-view.js';
import { entry, sampleVersion } from './fixtures.js';

const hostOf = (url: string) => /^https:\/\/([^/]+)/.exec(url)?.[1];
const today = parseCalendarDate('2026-11-06');

const first = entry();
const second = entry({
  number: 2,
  effectiveFrom: '2026-01-01',
  sources: [
    ...sampleVersion.sources,
    {
      id: 'guide',
      url: 'https://guide.example/route',
      title: 'Guide',
      kind: 'secondary',
      verifiedAt: '2026-10-02',
    },
  ],
  requirements: [
    { ...sampleVersion.requirements[0], title: 'The principal is of age' },
    {
      id: 'clean-record',
      title: 'No visa refusals',
      expression: {
        op: 'eq',
        left: { op: 'fact', key: 'principal.visaRefusals' },
        right: { op: 'int', value: 0 },
      },
      sources: ['law'],
    },
  ],
});
const cases: RuleCaseSummary[] = [
  {
    id: 'adult-with-means',
    principal: 'p1',
    rulesAsOf: parseCalendarDate('2026-10-01'),
    expected: { status: 'eligible', dependents: ['p2'], possibleDependents: [], missingFacts: [] },
  },
];

const states = (decided: Record<number, DecisionState>) =>
  new Map(
    [first, second].flatMap((version) => {
      const state = decided[version.identity.number];
      return state === undefined ? [] : [[identityKey(version.identity), state] as const];
    }),
  );

const view = (number: number, decided: Record<number, DecisionState> = {}) =>
  versionView({ versions: [first, second], number, cases, states: states(decided), today, hostOf });

describe('the activation view (spec 0007, R7)', () => {
  it('lays a version out with its state, hash, rules and the facts they read', () => {
    const shown = view(1, { 1: 'active' });
    expect(shown).toMatchObject({
      routeId: 'qm-sample',
      number: 1,
      hash: 'hash-1',
      state: 'active',
      country: 'QM',
      corrects: null,
      replaces: null,
      cases,
    });
    expect(shown?.requirements[0]).toEqual({
      id: 'adult',
      title: 'The principal is an adult',
      expression: {
        op: 'gte',
        left: {
          op: 'fact',
          key: 'person.ageYears',
          reference: 'principal.ageYears',
          target: 'principal',
        },
        right: { op: 'int', value: 18 },
      },
      facts: [{ reference: 'principal.ageYears', key: 'person.ageYears', target: 'principal' }],
      sources: ['law'],
    });
    expect(shown?.dependents.map(({ id, facts }) => [id, facts.map(({ key }) => key)])).toEqual([
      ['spouse', []],
      ['children', ['person.ageYears', 'person.hasSpouse']],
      ['parents', ['person.dependsOnPrincipal']],
    ]);
    expect(shown?.costs.map(({ id, appliesTo, condition }) => [id, appliesTo, condition])).toEqual([
      ['fee', 'principal', null],
      ['dependent-fee', 'each_dependent', null],
    ]);
    expect(shown?.countrySets).toEqual([
      { id: 'treaty', number: 2, title: 'Treaty countries', members: ['QM', 'QN'] },
    ]);
    expect(shown?.durations).toEqual(sampleVersion.durations);
  });

  it('says what changed from the version it replaces, and flags hosts new to the route', () => {
    const shown = view(2);
    expect(shown?.replaces).toEqual({
      number: 1,
      changes: {
        settings: { added: [], removed: [], changed: ['effectiveFrom'] },
        requirements: { added: ['clean-record'], removed: ['means'], changed: ['adult'] },
        assessments: { added: [], removed: [], changed: [] },
        dependents: { added: [], removed: [], changed: [] },
        costs: { added: [], removed: [], changed: [] },
        durations: { added: [], removed: [], changed: [] },
        sources: { added: ['guide'], removed: [], changed: [] },
        countrySets: { added: [], removed: [], changed: [] },
      },
    });
    expect(shown?.sources.map(({ id, host, newHost }) => [id, host, newHost])).toEqual([
      ['law', 'www.gov.example', false],
      ['guide', 'guide.example', true],
    ]);
    expect(view(1)?.sources.map(({ newHost }) => newHost)).toEqual([true]);
  });

  it('names a setting that changed even when every item stayed the same', () => {
    const leapDay = entry({ number: 2, leapDayBirthday: 'march-1' });
    const shown = versionView({
      versions: [first, leapDay],
      number: 2,
      cases: [],
      states: new Map(),
      today,
      hostOf,
    });
    expect(shown?.replaces?.changes.settings).toEqual({
      added: [],
      removed: [],
      changed: ['leapDayBirthday'],
    });
    expect(shown).toMatchObject({
      leapDayBirthday: 'march-1',
      leapDayBirthdaySources: ['law'],
      referenceDates: [],
      closureSources: [],
    });
  });

  it('flags a source whose URL names no plain host as new, with no host', () => {
    const odd = entry({
      number: 2,
      sources: [
        ...sampleVersion.sources,
        {
          id: 'odd',
          url: 'https://user@gov.example/law',
          title: 'Odd',
          kind: 'secondary',
          verifiedAt: '2026-10-02',
        },
      ],
    });
    const plainHostOf = (url: string) => (url.includes('@') ? undefined : hostOf(url));
    const shown = versionView({
      versions: [first, odd],
      number: 2,
      cases: [],
      states: new Map(),
      today,
      hostOf: plainHostOf,
    });
    expect(shown?.sources.map(({ id, host, newHost }) => [id, host, newHost])).toEqual([
      ['law', 'www.gov.example', false],
      ['odd', null, true],
    ]);
  });

  it('writes money in the currency units, never in minor units', () => {
    expect(view(1)?.costs[0]?.amount).toEqual({ op: 'money', amount: '100', currency: 'EUR' });
  });

  it('compares with the version a correction corrects', () => {
    const correction = entry({ number: 3, corrects: 1, effectiveFrom: '2020-01-01' });
    const shown = versionView({
      versions: [first, second, correction],
      number: 3,
      cases: [],
      states: new Map(),
      today,
      hostOf,
    });
    expect(shown?.replaces?.number).toBe(1);
    expect(shown?.corrects).toBe(1);
  });

  it.each<[string, Record<number, DecisionState>, number, object]>([
    [
      'the version in use falls back to the one before',
      { 1: 'active', 2: 'active' },
      2,
      { selected: true, fallback: { number: 1, state: 'active' } },
    ],
    [
      'a version waiting for activation falls back to the active one',
      { 1: 'active' },
      2,
      { selected: true, fallback: { number: 1, state: 'active' } },
    ],
    [
      'an older version not selected today changes nothing',
      { 1: 'active' },
      1,
      { selected: false, fallback: { number: 2, state: 'proposed' } },
    ],
    [
      'the version in use falls back to one still proposed',
      { 2: 'active' },
      2,
      { selected: true, fallback: { number: 1, state: 'proposed' } },
    ],
  ])('rejecting: %s', (_, decided, number, effect) => {
    expect(view(number, decided)?.rejection).toEqual(effect);
  });

  it('rejecting the only version leaves the route with none', () => {
    const shown = versionView({
      versions: [first],
      number: 1,
      cases: [],
      states: states({ 1: 'active' }),
      today,
      hostOf,
    });
    expect(shown?.rejection).toEqual({ selected: true, fallback: null });
  });

  it('has no view of a version the catalog does not hold', () => {
    expect(view(9)).toBeUndefined();
  });
});
