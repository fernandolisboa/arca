import { describe, expect, it } from 'vitest';
import { caseSnapshotSchema } from '../../src/index.js';

const base = { members: ['p1'], people: [{ id: 'p1' }], relationships: [], assets: [] };

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
});
