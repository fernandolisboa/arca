import { describe, expect, it } from 'vitest';
import { caseSnapshotSchema } from '../../src/case/snapshot.js';

const base = {
  recordedOn: '2026-11-03',
  members: ['p1'],
  people: [{ id: 'p1' }],
  relationships: [],
  assets: [],
};

function accepts(input: object): boolean {
  return caseSnapshotSchema.safeParse(input).success;
}

const asset = {
  id: 'a1',
  kind: 'cash',
  owners: [{ person: 'p1', share: '1' }],
  value: { amount: 1000, currency: 'EUR' },
  valuedAt: '2026-10-01',
};

describe('CaseSnapshot', () => {
  it('accepts a minimal synthetic snapshot', () => {
    expect(accepts(base)).toBe(true);
  });

  it.each([
    ['a name', { ...base, people: [{ id: 'p1', name: 'x' }] }],
    ['free text', { ...base, people: [{ id: 'p1', notes: 'x' }] }],
    ['a document number', { ...base, people: [{ id: 'p1', passportNumber: 'x' }] }],
    ['an unknown top-level key', { ...base, comment: 'x' }],
    ['an ID with spaces', { ...base, members: ['p 1'], people: [{ id: 'p 1' }] }],
    ['a duplicate person', { ...base, people: [{ id: 'p1' }, { id: 'p1' }] }],
    ['a dangling member', { ...base, members: ['p2'] }],
    [
      'a dangling edge',
      { ...base, relationships: [{ kind: 'parent', parent: 'p9', child: 'p1' }] },
    ],
    ['a self edge', { ...base, relationships: [{ kind: 'spouse', people: ['p1', 'p1'] }] }],
    [
      'a negative asset',
      { ...base, assets: [{ ...asset, value: { amount: -1, currency: 'EUR' } }] },
    ],
    [
      'shares above 1',
      {
        ...base,
        people: [{ id: 'p1' }, { id: 'p2' }],
        assets: [
          {
            ...asset,
            owners: [
              { person: 'p1', share: '0.6' },
              { person: 'p2', share: '0.5' },
            ],
          },
        ],
      },
    ],
    ['a zero share', { ...base, assets: [{ ...asset, owners: [{ person: 'p1', share: '0' }] }] }],
    [
      'a malformed share',
      { ...base, assets: [{ ...asset, owners: [{ person: 'p1', share: 'x' }] }] },
    ],
    ['a lowercase country', { ...base, people: [{ id: 'p1', residenceCountry: 'br' }] }],
    ['an unknown marker', { ...base, people: [{ id: 'p1', recordedInFull: ['siblings'] }] }],
    [
      'an ID that reads as a name',
      { ...base, members: ['maria-silva'], people: [{ id: 'maria-silva' }] },
    ],
    [
      'an ID that reads as a document number',
      { ...base, members: ['12345678909'], people: [{ id: '12345678909' }] },
    ],
    [
      'a negative income',
      {
        ...base,
        people: [
          {
            id: 'p1',
            incomes: [
              { kind: 'active', monthly: { amount: -1, currency: 'EUR' }, sourceCountry: 'QM' },
            ],
          },
        ],
      },
    ],
    [
      'a duplicate owner',
      {
        ...base,
        assets: [
          {
            ...asset,
            owners: [
              { person: 'p1', share: '0.5' },
              { person: 'p1', share: '0.5' },
            ],
          },
        ],
      },
    ],
    [
      'an unknown owner',
      { ...base, assets: [{ ...asset, owners: [{ person: 'p9', share: '1' }] }] },
    ],
    ['a duplicate asset', { ...base, assets: [asset, asset] }],
    ['a duplicate member', { ...base, members: ['p1', 'p1'] }],
    [
      'a duplicate marker',
      { ...base, people: [{ id: 'p1', recordedInFull: ['assets', 'assets'] }] },
    ],
    ['self-dependence', { ...base, people: [{ id: 'p1', financiallyDependentOn: ['p1'] }] }],
    [
      'dependence on nobody known',
      { ...base, people: [{ id: 'p1', financiallyDependentOn: ['p9'] }] },
    ],
    [
      'a citizenship lost before it was acquired',
      {
        ...base,
        people: [
          {
            id: 'p1',
            citizenships: [{ country: 'QM', acquired: '2010-01-01', lost: '2009-12-31' }],
          },
        ],
      },
    ],
    [
      'a parent cycle',
      {
        ...base,
        people: [{ id: 'p1' }, { id: 'p2' }],
        relationships: [
          { kind: 'parent', parent: 'p1', child: 'p2' },
          { kind: 'parent', parent: 'p2', child: 'p1' },
        ],
      },
    ],
    [
      'a duplicate parent edge',
      {
        ...base,
        people: [{ id: 'p1' }, { id: 'p2' }],
        relationships: [
          { kind: 'parent', parent: 'p2', child: 'p1' },
          { kind: 'parent', parent: 'p2', child: 'p1', parentKind: 'biological' },
        ],
      },
    ],
    [
      'the same marriage twice, in either order',
      {
        ...base,
        people: [{ id: 'p1' }, { id: 'p2' }],
        relationships: [
          { kind: 'spouse', people: ['p1', 'p2'], start: '2010-01-01' },
          { kind: 'spouse', people: ['p2', 'p1'], start: '2010-01-01' },
        ],
      },
    ],
    [
      'more than four parents',
      {
        ...base,
        people: [{ id: 'p1' }, ...[2, 3, 4, 5, 6].map((n) => ({ id: `p${String(n)}` }))],
        relationships: [2, 3, 4, 5, 6].map((n) => ({
          kind: 'parent',
          parent: `p${String(n)}`,
          child: 'p1',
        })),
      },
    ],
    [
      'more than four couple edges between the same two people',
      {
        ...base,
        people: [{ id: 'p1' }, { id: 'p2' }],
        relationships: ['2001', '2002', '2003', '2004', '2005'].map((year, index) => ({
          kind: index % 2 === 0 ? 'spouse' : 'partner',
          people: ['p1', 'p2'],
          start: `${year}-01-01`,
        })),
      },
    ],
    [
      'an unknown ISIC section',
      {
        ...base,
        people: [{ id: 'p1', jobOffers: [{ country: 'QM', sector: 'Z', temporary: true }] }],
      },
    ],
  ])('rejects %s', (_label, input) => {
    expect(accepts(input)).toBe(false);
  });

  it('accepts unknown, none and dates for things that may not have happened', () => {
    for (const lost of [undefined, 'none', '2001-05-02', '2001']) {
      const citizenship = lost === undefined ? { country: 'QM' } : { country: 'QM', lost };
      expect(accepts({ ...base, people: [{ id: 'p1', citizenships: [citizenship] }] })).toBe(true);
    }
    for (const sold of [undefined, 'none', '2025-01-10']) {
      expect(accepts({ ...base, assets: [sold === undefined ? asset : { ...asset, sold }] })).toBe(
        true,
      );
    }
  });

  it('holds people who are not case members, such as grandparents', () => {
    expect(
      accepts({
        ...base,
        people: [{ id: 'p1' }, { id: 'g1', birthDate: '1931' }],
        relationships: [{ kind: 'parent', parent: 'g1', child: 'p1' }],
      }),
    ).toBe(true);
  });

  it('accepts a former country code in a citizenship', () => {
    expect(
      accepts({
        ...base,
        people: [{ id: 'p1', citizenships: [{ country: 'YUCS', basis: 'birth' }] }],
      }),
    ).toBe(true);
  });

  it('accepts a remarriage of the same couple with a new start', () => {
    expect(
      accepts({
        ...base,
        people: [{ id: 'p1' }, { id: 'p2' }],
        relationships: [
          { kind: 'spouse', people: ['p1', 'p2'], start: '2001-01-01', end: '2005-01-01' },
          { kind: 'spouse', people: ['p1', 'p2'], start: '2010-01-01', end: 'none' },
        ],
      }),
    ).toBe(true);
  });

  it('accepts a couple that divorced and remarried within the same year', () => {
    expect(
      accepts({
        ...base,
        people: [{ id: 'p1' }, { id: 'p2' }],
        relationships: [
          { kind: 'spouse', people: ['p1', 'p2'], start: '2010', end: '2010' },
          { kind: 'spouse', people: ['p1', 'p2'], start: '2010', end: 'none' },
        ],
      }),
    ).toBe(true);
  });

  it('accepts four parents, such as two biological and two adoptive', () => {
    expect(
      accepts({
        ...base,
        people: [{ id: 'p1' }, ...[2, 3, 4, 5].map((n) => ({ id: `p${String(n)}` }))],
        relationships: [2, 3, 4, 5].map((n) => ({
          kind: 'parent',
          parent: `p${String(n)}`,
          child: 'p1',
        })),
      }),
    ).toBe(true);
  });

  it('accepts a citizenship lost in the year it was acquired, when only the year is known', () => {
    expect(
      accepts({
        ...base,
        people: [
          { id: 'p1', citizenships: [{ country: 'QM', acquired: '2010-06-01', lost: '2010' }] },
        ],
      }),
    ).toBe(true);
  });
});
