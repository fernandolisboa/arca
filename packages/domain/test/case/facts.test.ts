import { describe, expect, it } from 'vitest';
import { type FactBinding, factCatalog, isFactKey } from '../../src/index.js';
import { derive, environment, snapshot } from './builders.js';

const integer = (min: number | undefined, max: number | undefined): object => ({
  type: 'number',
  ...(min === undefined ? {} : { min: { units: BigInt(min), scale: 0 } }),
  ...(max === undefined ? {} : { max: { units: BigInt(max), scale: 0 } }),
});

const euros = (min: bigint, max?: bigint): object => ({
  type: 'number',
  currency: 'EUR',
  min: { units: min, scale: 0, currency: 'EUR' },
  ...(max === undefined ? {} : { max: { units: max, scale: 0, currency: 'EUR' } }),
});

describe('fact catalog', () => {
  it('knows its keys', () => {
    expect(isFactKey('person.ageYears')).toBe(true);
    expect(isFactKey('person.name')).toBe(false);
    expect(isFactKey('toString')).toBe(false);
  });

  it('marks every age fact and birth-date fact', () => {
    expect(factCatalog['person.ageYears'].readsAge).toBe(true);
    expect(factCatalog['person.birthDate'].isBirthDate).toBe(true);
    expect(factCatalog['lineage.childBirthDate'].isBirthDate).toBe(true);
  });
});

describe('person.ageYears', () => {
  it.each([
    [{ birthDate: '2008-11-04' }, integer(17, 17)],
    [{ birthDate: '2008-11-03' }, integer(18, 18)],
    [{ birthDate: '2008' }, integer(17, 18)],
    [{ birthDate: '2008-02' }, integer(18, 18)],
    [{}, integer(0, undefined)],
    [{ birthDate: '2027-01-01' }, integer(0, 0)],
  ])('case %#', (facts, expected) => {
    const env = environment(snapshot({ people: [{ id: 'p1', ...facts }] }));
    expect(derive('person.ageYears', { environment: env, personId: 'p1' }).value).toEqual(expected);
  });

  it('refuses to compute an age without the leap-day convention', () => {
    const value = snapshot({ people: [{ id: 'p1', birthDate: '2000-01-01' }] });
    const env = environment(value);
    delete (env as { leapDayBirthday?: unknown }).leapDayBirthday;
    expect(() => derive('person.ageYears', { environment: env, personId: 'p1' })).toThrow(
      RangeError,
    );
  });
});

describe('person.citizenships: unknown, none, a date, empty and complete', () => {
  it.each([
    ['no list (unknown)', undefined, { definite: [], possible: [], complete: false }],
    ['an empty list (none)', [], { definite: [], possible: [], complete: true }],
    [
      'lost unknown',
      [{ country: 'QM', acquired: '2000-01-01' }],
      { definite: [], possible: ['QM'], complete: true },
    ],
    [
      'lost "none"',
      [{ country: 'QM', acquired: '2000-01-01', lost: 'none' }],
      { definite: ['QM'], possible: [], complete: true },
    ],
    [
      'lost before the date',
      [{ country: 'QM', acquired: '2000-01-01', lost: '2010-05-01' }],
      { definite: [], possible: [], complete: true },
    ],
    [
      'lost after the date',
      [{ country: 'QM', acquired: '2000-01-01', lost: '2030-05-01' }],
      { definite: ['QM'], possible: [], complete: true },
    ],
    [
      'lost in the same year, partially known',
      [{ country: 'QM', acquired: '2000-01-01', lost: '2026' }],
      { definite: [], possible: ['QM'], complete: true },
    ],
    [
      'acquired unknown',
      [{ country: 'QM', lost: 'none' }],
      { definite: [], possible: ['QM'], complete: true },
    ],
    [
      'by birth, with no acquisition date',
      [{ country: 'QN', basis: 'birth', lost: 'none' }],
      { definite: ['QN'], possible: [], complete: true },
    ],
  ])('%s', (_label, citizenships, expected) => {
    const person = citizenships === undefined ? { id: 'p1' } : { id: 'p1', citizenships };
    const env = environment(snapshot({ people: [person] }));
    expect(derive('person.citizenships', { environment: env, personId: 'p1' }).value).toEqual({
      type: 'tokens',
      ...expected,
    });
  });
});

describe('person.hasSpouse: edge end and the completeness marker', () => {
  const people = (markers: string[] | undefined): object[] => [
    markers === undefined ? { id: 'p1' } : { id: 'p1', recordedInFull: markers },
    { id: 'p2' },
  ];
  const edge = (end?: string): object => ({
    kind: 'spouse',
    people: ['p1', 'p2'],
    start: '2010-06-01',
    ...(end === undefined ? {} : { end }),
  });

  it.each([
    ['end unknown', [edge()], undefined, 'unknown'],
    ['end "none"', [edge('none')], undefined, true],
    ['ended, not recorded in full', [edge('2020-01-01')], undefined, 'unknown'],
    ['ended, recorded in full', [edge('2020-01-01')], ['spouses'], false],
    ['no edge, not recorded in full', [], undefined, 'unknown'],
    ['no edge, recorded in full', [], ['spouses'], false],
    ['no edge, other markers only', [], ['children', 'parents'], 'unknown'],
  ])('%s', (_label, relationships, markers, expected) => {
    const env = environment(snapshot({ people: people(markers), relationships }));
    expect(derive('person.hasSpouse', { environment: env, personId: 'p1' }).value).toEqual({
      type: 'boolean',
      value: expected,
    });
  });

  it('does not reach a marriage that starts after the date', () => {
    const env = environment(
      snapshot({
        people: people(['spouses']),
        relationships: [{ kind: 'spouse', people: ['p1', 'p2'], start: '2027-01-01', end: 'none' }],
      }),
    );
    expect(derive('person.hasSpouse', { environment: env, personId: 'p1' }).value).toEqual({
      type: 'boolean',
      value: false,
    });
  });
});

describe('person.liquidAssets', () => {
  const asset = (extra: object): object => ({
    id: 'a1',
    kind: 'cash',
    owners: [{ person: 'p1', share: '1' }],
    value: { amount: 1000, currency: 'EUR' },
    valuedAt: '2026-10-01',
    liquid: true,
    sold: 'none',
    ...extra,
  });

  it.each([
    ['held', {}, euros(1000n, 1000n)],
    ['sold unknown', { sold: undefined }, euros(0n, 1000n)],
    ['sold before the date', { sold: '2026-01-01' }, euros(0n, 0n)],
    ['sold after the date', { sold: '2027-01-01' }, euros(1000n, 1000n)],
    ['liquidity unknown', { liquid: undefined }, euros(0n, 1000n)],
    ['not liquid', { liquid: false }, euros(0n, 0n)],
  ])('%s', (_label, extra, expected) => {
    const raw = asset(extra) as Record<string, unknown>;
    const cleaned = Object.fromEntries(
      Object.entries(raw).filter(([, value]) => value !== undefined),
    );
    const env = environment(snapshot({ assets: [cleaned] }));
    expect(derive('person.liquidAssets', { environment: env, personId: 'p1' }).value).toEqual(
      expected,
    );
  });

  it('counts the owner share and converts to the route currency', () => {
    const env = environment(
      snapshot({
        people: [{ id: 'p1' }, { id: 'p2' }],
        assets: [
          asset({
            owners: [
              { person: 'p1', share: '0.5' },
              { person: 'p2', share: '0.5' },
            ],
            value: { amount: 3000, currency: 'USD' },
          }),
        ],
      }),
    );
    expect(derive('person.liquidAssets', { environment: env, personId: 'p1' }).value).toEqual(
      euros(750n, 750n),
    );
  });

  it('reports a missing rate and leaves the total unbounded above', () => {
    const env = environment(
      snapshot({ assets: [asset({ value: { amount: 3000, currency: 'BRL' } })] }),
    );
    expect(derive('person.liquidAssets', { environment: env, personId: 'p1' })).toEqual({
      value: euros(0n),
      missingRates: [{ from: 'BRL', to: 'EUR' }],
    });
  });

  it('adds what possible unit members might own, as a range', () => {
    const env = environment(
      snapshot({
        members: ['p1', 'p2'],
        people: [{ id: 'p1' }, { id: 'p2' }],
        assets: [asset({}), asset({ id: 'a2', owners: [{ person: 'p2', share: '1' }] })],
      }),
      { unit: { included: ['p1'], possible: ['p2'] } },
    );
    expect(derive('unit.liquidAssets', { environment: env, personId: 'p1' }).value).toEqual(
      euros(1000n, 2000n),
    );
  });
});

describe('other person facts', () => {
  it('sums monthly passive income; unknown when no list, zero when empty', () => {
    const income = (amount: number, kind = 'passive'): object => ({
      kind,
      monthly: { amount, currency: 'EUR' },
      sourceCountry: 'QM',
    });
    const read = (incomes?: object[]): unknown =>
      derive('person.monthlyPassiveIncome', {
        environment: environment(
          snapshot({ people: [incomes === undefined ? { id: 'p1' } : { id: 'p1', incomes }] }),
        ),
        personId: 'p1',
      }).value;
    expect(read()).toEqual(euros(0n));
    expect(read([])).toEqual(euros(0n, 0n));
    expect(read([income(100), income(250), income(999, 'active')])).toEqual(euros(350n, 350n));
  });

  it('counts visa refusals up to the date', () => {
    const read = (history?: object[]): unknown =>
      derive('person.visaRefusals', {
        environment: environment(
          snapshot({
            people: [
              history === undefined ? { id: 'p1' } : { id: 'p1', immigrationHistory: history },
            ],
          }),
        ),
        personId: 'p1',
      }).value;
    expect(read()).toEqual(integer(0, undefined));
    expect(read([])).toEqual(integer(0, 0));
    expect(
      read([
        { country: 'QM', kind: 'visa_refusal', date: '2020-01-01' },
        { country: 'QM', kind: 'visa_refusal' },
        { country: 'QM', kind: 'visa_refusal', date: '2030-01-01' },
        { country: 'QM', kind: 'visa_granted', date: '2021-01-01' },
      ]),
    ).toEqual(integer(1, 2));
  });

  it('reads financial dependence on the principal', () => {
    const read = (dependsOn?: string[]): unknown =>
      derive('person.dependsOnPrincipal', {
        environment: environment(
          snapshot({
            people: [
              { id: 'p1' },
              dependsOn === undefined
                ? { id: 'p2' }
                : { id: 'p2', financiallyDependentOn: dependsOn },
            ],
          }),
        ),
        personId: 'p2',
      }).value;
    expect(read()).toEqual({ type: 'boolean', value: 'unknown' });
    expect(read([])).toEqual({ type: 'boolean', value: false });
    expect(read(['p1'])).toEqual({ type: 'boolean', value: true });
  });

  it('lists temporary job offer sectors in the route country only', () => {
    const env = environment(
      snapshot({
        people: [
          {
            id: 'p1',
            jobOffers: [
              { country: 'QM', sector: 'A', temporary: true },
              { country: 'QM', sector: 'C', temporary: false },
              { country: 'QN', sector: 'B', temporary: true },
            ],
          },
        ],
      }),
    );
    expect(
      derive('person.temporaryJobOfferSectors', { environment: env, personId: 'p1' }).value,
    ).toEqual({
      type: 'tokens',
      definite: ['A'],
      possible: [],
      complete: true,
    });
  });
});

describe('edge and lineage facts', () => {
  // Synthetic line: great-grandparent g2 -> grandparent g1 (adoptive) -> parent m1 -> principal p1.
  const line = snapshot({
    members: ['p1'],
    people: [
      { id: 'p1', birthDate: '1990-04-02' },
      { id: 'm1', birthDate: '1961' },
      {
        id: 'g1',
        birthDate: '1930',
        citizenships: [
          { country: 'QM', basis: 'birth', lost: 'none' },
          { country: 'QN', acquired: '1961-06', lost: 'none' },
        ],
      },
      { id: 'g2', citizenships: [{ country: 'CSHH', basis: 'birth', lost: '1993-01-01' }] },
    ],
    relationships: [
      { kind: 'parent', parent: 'm1', child: 'p1', parentKind: 'biological' },
      { kind: 'parent', parent: 'g1', child: 'm1', parentKind: 'adoptive', start: '1962-03-01' },
      { kind: 'parent', parent: 'g2', child: 'g1', parentKind: 'biological' },
    ],
  });
  const env = environment(line);
  const path = ['g2', 'g1', 'm1', 'p1'];

  it('reads the generation and the kind of link toward the principal', () => {
    const at = (personId: string, position: number): FactBinding => ({
      environment: env,
      personId,
      lineage: { path, position },
    });
    expect(derive('lineage.generation', at('g1', 1)).value).toEqual(integer(2, 2));
    expect(derive('lineage.edgeKind', at('g1', 1)).value).toEqual({
      type: 'token',
      value: 'adoptive',
    });
    expect(derive('lineage.childBirthDate', at('g1', 1)).value).toEqual({
      type: 'date',
      min: '1961-01-01',
      max: '1961-12-31',
    });
  });

  it('reads citizenships at the next birth, unknown when the dates overlap', () => {
    expect(
      derive('lineage.citizenshipsAtChildBirth', {
        environment: env,
        personId: 'g1',
        lineage: { path, position: 1 },
      }).value,
    ).toEqual({ type: 'tokens', definite: ['QM'], possible: ['QN'], complete: true });
    expect(
      derive('lineage.citizenshipsAtChildBirth', {
        environment: env,
        personId: 'g2',
        lineage: { path, position: 0 },
      }).value,
    ).toEqual({ type: 'tokens', definite: ['CSHH'], possible: [], complete: true });
  });

  it('reads the parent edge a dependent was reached by', () => {
    const edge = line.relationships[1];
    expect(
      derive('edge.parentKind', { environment: env, personId: 'm1', ...(edge ? { edge } : {}) })
        .value,
    ).toEqual({
      type: 'token',
      value: 'adoptive',
    });
    expect(
      derive('edge.start', { environment: env, personId: 'm1', ...(edge ? { edge } : {}) }).value,
    ).toEqual({
      type: 'date',
      min: '1962-03-01',
      max: '1962-03-01',
    });
  });
});
