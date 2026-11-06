import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import {
  type VisibleCaseRows,
  buildCaseSnapshot,
  storedAssetSchema,
  storedFinancesSchema,
  storedProfileFactsSchema,
  storedRelationshipSchema,
  validCaseStructure,
} from '../../src/index.js';

/** Synthetic UUIDs only. */
const alice = '0b9c3d6e-1f2a-4b5c-8d7e-9f0a1b2c3d4e';
const bruno = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const child = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const grandma = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';
const house = '3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b';
const car = '4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c';

const recordedOn = parseCalendarDate('2026-11-06');
const facts = (value: unknown) => storedProfileFactsSchema.parse(value);
const finances = (value: unknown) => storedFinancesSchema.parse(value);
const asset = (value: unknown) => storedAssetSchema.parse(value);
const edge = (value: unknown) => storedRelationshipSchema.parse(value);

const people = [
  { id: alice, caseMember: true },
  { id: bruno, caseMember: true },
  { id: child, caseMember: true },
  { id: grandma, caseMember: false },
];
const relationships = [
  edge({ kind: 'spouse', from: alice, to: bruno, details: {} }),
  edge({ kind: 'parent', from: alice, to: child, details: { parentKind: 'biological' } }),
  edge({ kind: 'parent', from: grandma, to: alice, details: {} }),
];
const houseRow = {
  id: house,
  ...asset({
    kind: 'real_estate',
    value: { amount: 50000000, currency: 'BRL' },
    valuedAt: '2026-01-10',
  }),
};
const carRow = {
  id: car,
  ...asset({
    kind: 'vehicle',
    value: { amount: 8000000, currency: 'BRL' },
    valuedAt: '2026-02-01',
  }),
};

const rows = (overrides: Partial<VisibleCaseRows> = {}): VisibleCaseRows => ({
  people,
  profiles: [],
  dependence: [],
  finances: [],
  relationships,
  assets: [],
  owners: [],
  ...overrides,
});

describe('the snapshot builder (spec 0007, R3)', () => {
  it('replaces UUIDs with opaque IDs and keeps members, people and relationships', () => {
    const built = buildCaseSnapshot(rows(), recordedOn);
    expect(Object.fromEntries(built.personIds)).toEqual({
      [alice]: 'p1',
      [bruno]: 'p2',
      [child]: 'p3',
      [grandma]: 'p4',
    });
    expect(built.snapshot).toEqual({
      recordedOn: '2026-11-06',
      members: ['p1', 'p2', 'p3'],
      people: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }],
      relationships: [
        { kind: 'spouse', people: ['p1', 'p2'] },
        { kind: 'parent', parent: 'p1', child: 'p3', parentKind: 'biological' },
        { kind: 'parent', parent: 'p4', child: 'p1' },
      ],
      assets: [],
    });
    expect(JSON.stringify(built.snapshot)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it.each([
    ['dependence not answered is unknown', false, [], undefined],
    ['answered with nobody is an empty list', true, [], []],
    ['answered with people lists them', true, [{ personId: child, dependsOnId: alice }], ['p1']],
  ] as const)('%s', (_case, dependenceAnswered, dependence, expected) => {
    const built = buildCaseSnapshot(
      rows({
        profiles: [{ personId: child, facts: facts({ studying: true }), dependenceAnswered }],
        dependence,
      }),
      recordedOn,
    );
    const person = built.snapshot.people[2];
    expect(person?.studying).toBe(true);
    expect(person?.financiallyDependentOn).toEqual(expected);
  });

  it.each([
    ['no finances leave incomes and the assets marker unknown', [], undefined, undefined],
    [
      'finances without the marker give incomes only',
      [{ personId: alice, ...finances({ incomes: [], assetsRecordedInFull: false }) }],
      [],
      ['children'],
    ],
    [
      'finances with the marker add it to the profile markers',
      [{ personId: alice, ...finances({ assetsRecordedInFull: true }) }],
      undefined,
      ['children', 'assets'],
    ],
  ] as const)('%s', (_case, visibleFinances, incomes, markers) => {
    const built = buildCaseSnapshot(
      rows({
        profiles: [
          {
            personId: alice,
            facts: facts({ recordedInFull: ['children'] }),
            dependenceAnswered: false,
          },
        ],
        finances: visibleFinances,
      }),
      recordedOn,
    );
    const person = built.snapshot.people[0];
    expect(person?.incomes).toEqual(incomes);
    expect(person?.recordedInFull).toEqual(markers ?? ['children']);
  });

  it.each([
    ['an asset with no visible owner row is left out', [], []],
    [
      'an asset with only a pending row is left out',
      [{ assetId: house, personId: alice, share: '1.000000', confirmed: false }],
      [],
    ],
    [
      'an asset keeps only its visible confirmed rows as owners',
      [
        { assetId: house, personId: alice, share: '0.500000', confirmed: true },
        { assetId: house, personId: bruno, share: '0.500000', confirmed: false },
        { assetId: car, personId: bruno, share: '1.000000', confirmed: false },
      ],
      [{ id: 'a1', owners: [{ person: 'p1', share: '0.500000' }] }],
    ],
  ] as const)('%s', (_case, owners, expected) => {
    const built = buildCaseSnapshot(rows({ assets: [houseRow, carRow], owners }), recordedOn);
    expect(built.snapshot.assets.map(({ id, owners: kept }) => ({ id, owners: kept }))).toEqual(
      expected,
    );
    expect(built.assetIds.size).toBe(expected.length);
  });

  it('carries an asset’s fields', () => {
    const built = buildCaseSnapshot(
      rows({
        assets: [houseRow],
        owners: [{ assetId: house, personId: alice, share: '1', confirmed: true }],
      }),
      recordedOn,
    );
    expect(built.snapshot.assets[0]).toEqual({
      id: 'a1',
      kind: 'real_estate',
      value: { amount: 50000000, currency: 'BRL' },
      valuedAt: '2026-01-10',
      owners: [{ person: 'p1', share: '1' }],
    });
  });

  it('refuses rows that refer to someone outside the case', () => {
    expect(() =>
      buildCaseSnapshot(
        rows({ dependence: [{ personId: alice, dependsOnId: house }] }),
        recordedOn,
      ),
    ).not.toThrow();
    expect(() =>
      buildCaseSnapshot(
        rows({
          profiles: [{ personId: alice, facts: facts({}), dependenceAnswered: true }],
          dependence: [{ personId: alice, dependsOnId: house }],
        }),
        recordedOn,
      ),
    ).toThrow();
  });
});

describe('the case structure check (spec 0007, R1)', () => {
  const parent = (from: string, to: string) => edge({ kind: 'parent', from, to, details: {} });

  it.each([
    ['the family as it is', relationships, true],
    ['a parent cycle', [...relationships, parent(child, grandma)], false],
    ['the same edge twice', [...relationships, parent(alice, child)], false],
    [
      'five couple edges between two people',
      Array.from({ length: 5 }, () =>
        edge({ kind: 'partner', from: alice, to: bruno, details: {} }),
      ),
      false,
    ],
    [
      'an edge to someone outside the case',
      [parent(alice, '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d')],
      false,
    ],
  ] as const)('%s: %s', (_case, edges, valid) => {
    expect(validCaseStructure(people, edges, recordedOn)).toBe(valid);
  });

  it('holds the limits on people and members', () => {
    const many = Array.from({ length: 61 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      caseMember: index < 30,
    }));
    expect(validCaseStructure(many.slice(0, 60), [], recordedOn)).toBe(true);
    expect(validCaseStructure(many, [], recordedOn)).toBe(false);
    expect(
      validCaseStructure(
        many.slice(0, 31).map(({ id }) => ({ id, caseMember: true })),
        [],
        recordedOn,
      ),
    ).toBe(false);
  });
});
