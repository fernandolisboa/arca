import { describe, expect, it } from 'vitest';
import type { CaseSnapshot } from '../../src/case/snapshot.js';
import type { Truth } from '../../src/logic/truth.js';
import { type DocumentChecklist, documentChecklist } from '../../src/rules/documents.js';
import { snapshot } from '../case/builders.js';
import { context, entry } from './fixtures.js';

const everything = ['spouses', 'partners', 'children', 'parents', 'assets'];
const fact = (key: string): object => ({ op: 'fact', key });
const int = (value: number): object => ({ op: 'int', value });

/** Synthetic documents only: invented titles, kinds and conditions. */
const item = (id: string, appliesTo: string, extra: object = {}): object => ({
  id,
  title: `Document ${id}`,
  kind: id.replaceAll('-', '_'),
  appliesTo,
  sources: ['law'],
  ...extra,
});

const documents = [
  item('passport', 'principal', { validity: 'P6M', apostille: false, translation: 'none' }),
  item('pension-proof', 'principal', {
    condition: { op: 'gte', left: fact('principal.ageYears'), right: int(65) },
  }),
  item('police-record', 'principal', {
    condition: { op: 'gte', left: fact('principal.ageYears'), right: int(18) },
    apostille: true,
    translation: 'sworn',
    note: 'Issued by the federal police',
  }),
  item('birth-certificate', 'each_dependent', { apostille: true, translation: 'sworn' }),
  item('parental-consent', 'each_dependent', {
    condition: { op: 'lt', left: fact('person.ageYears'), right: int(18) },
  }),
  item('enrollment-proof', 'each_dependent', { condition: fact('person.studying') }),
  item('bank-statement', 'unit', {
    condition: {
      op: 'gte',
      left: fact('unit.liquidAssets'),
      right: { op: 'money', amount: 1000_00, currency: 'EUR' },
    },
  }),
];

const cash = (owner: string, amount: number): object => ({
  id: `a${owner.slice(1)}`,
  kind: 'cash',
  owners: [{ person: owner, share: '1' }],
  value: { amount, currency: 'EUR' },
  valuedAt: '2026-10-01',
  liquid: true,
  sold: 'none',
});

/**
 * A synthetic family: a spouse, a minor child, a child with no birth date (so a possible
 * dependent) and an adult child the route does not cover.
 */
function family(
  principalBirth?: string,
  { cash: amount = 3000_00, assetsInFull = true }: { cash?: number; assetsInFull?: boolean } = {},
): CaseSnapshot {
  const principalInFull = assetsInFull
    ? everything
    : everything.filter((marker) => marker !== 'assets');
  return snapshot({
    members: ['p1'],
    people: [
      {
        id: 'p1',
        ...(principalBirth === undefined ? {} : { birthDate: principalBirth }),
        recordedInFull: principalInFull,
      },
      { id: 'p2', birthDate: '1982-01-01', recordedInFull: everything },
      { id: 'p3', birthDate: '2010-05-01', recordedInFull: everything },
      { id: 'p4', recordedInFull: everything },
      { id: 'p5', birthDate: '2000-01-01', recordedInFull: everything },
    ],
    relationships: [
      { kind: 'spouse', people: ['p1', 'p2'], start: '2005-01-01', end: 'none' },
      { kind: 'parent', parent: 'p1', child: 'p3', parentKind: 'biological' },
      { kind: 'parent', parent: 'p1', child: 'p4', parentKind: 'biological' },
      { kind: 'parent', parent: 'p1', child: 'p5', parentKind: 'biological' },
    ],
    assets: [cash('p1', amount)],
  });
}

function checklist(value: CaseSnapshot, patch: object = { documents }): DocumentChecklist {
  return documentChecklist(value, entry(patch), 'p1', context());
}

function listed(value: CaseSnapshot): Extract<DocumentChecklist, { kind: 'listed' }> {
  const result = checklist(value);
  if (result.kind !== 'listed') throw new Error('A listed checklist');
  return result;
}

/** Each list's items as `documentId: truth`, by person, with the unit's under `unit`. */
function truths(value: CaseSnapshot): Record<string, Record<string, Truth>> {
  const result = listed(value);
  const byId = (items: readonly { documentId: string; applies: Truth }[]) =>
    Object.fromEntries(items.map(({ documentId, applies }) => [documentId, applies]));
  return {
    [result.principal.personId]: byId(result.principal.items),
    ...Object.fromEntries(result.dependents.map((person) => [person.personId, byId(person.items)])),
    unit: byId(result.unit),
  };
}

describe('documentChecklist', () => {
  it('knows nothing about a version with no document list', () => {
    expect(checklist(family('1980-01-01'), {})).toEqual({ kind: 'not_covered' });
  });

  it('lists every person in the unit, with no items, when the route asks for none', () => {
    const result = checklist(family('1980-01-01'), { documents: [] });
    expect(result).toMatchObject({
      kind: 'listed',
      principal: { personId: 'p1', possible: false, items: [] },
      unit: [],
    });
    expect(result.kind === 'listed' && result.dependents.map((person) => person.items)).toEqual([
      [],
      [],
      [],
    ]);
  });

  it('lists the principal, then dependents, then possible dependents, and no one else', () => {
    const result = listed(family('1980-01-01'));
    expect(result.dependents.map(({ personId, possible }) => [personId, possible])).toEqual([
      ['p2', false],
      ['p3', false],
      ['p4', true],
    ]);
  });

  it.each<[string, string, string, Truth]>([
    ['an unconditional principal item', 'p1', 'passport', true],
    ['a principal condition that holds', 'p1', 'police-record', true],
    ['a principal condition that does not hold', 'p1', 'pension-proof', false],
    ['an unconditional item for a dependent', 'p2', 'birth-certificate', true],
    ["a dependent's condition that does not hold", 'p2', 'parental-consent', false],
    ["a dependent's condition that holds", 'p3', 'parental-consent', true],
    ['an unconditional item for a possible dependent', 'p4', 'birth-certificate', 'unknown'],
    ["a possible dependent's unknown condition", 'p4', 'parental-consent', 'unknown'],
    ['a unit condition that holds', 'unit', 'bank-statement', true],
    ["a dependent's condition on a fact not recorded", 'p2', 'enrollment-proof', 'unknown'],
  ])('decides %s', (_label, person, documentId, expected) => {
    expect(truths(family('1980-01-01'))[person]?.[documentId]).toBe(expected);
  });

  it.each<[string, Parameters<typeof family>[1], Truth]>([
    ['does not hold', { cash: 500_00 }, false],
    ['may hold, with assets not all recorded', { cash: 500_00, assetsInFull: false }, 'unknown'],
  ])('decides a unit condition that %s', (_label, options, expected) => {
    expect(truths(family('1980-01-01', options))['unit']?.['bank-statement']).toBe(expected);
  });

  it('leaves a principal condition unknown when the fact it reads is missing', () => {
    const principal = truths(family())['p1'];
    expect(principal).toEqual({
      passport: true,
      'pension-proof': 'unknown',
      'police-record': 'unknown',
    });
  });

  it('puts each item on its own list only: principal, each dependent or the unit once', () => {
    const result = listed(family('1980-01-01'));
    expect(result.principal.items.map((each) => each.documentId)).toEqual([
      'passport',
      'pension-proof',
      'police-record',
    ]);
    for (const person of result.dependents) {
      expect(person.items.map((each) => each.documentId)).toEqual([
        'birth-certificate',
        'parental-consent',
        'enrollment-proof',
      ]);
    }
    expect(result.unit.map((each) => each.documentId)).toEqual(['bank-statement']);
  });

  it("gives each item's details, its sources and the traces its condition read", () => {
    const result = listed(family('1980-01-01'));
    const [passport, , police] = result.principal.items;
    expect(passport).toMatchObject({
      kind: 'passport',
      appliesTo: 'principal',
      apostille: false,
      translation: 'none',
      validity: 'P6M',
      traces: [],
    });
    expect(passport && 'note' in passport).toBe(false);
    const [, pension] = result.principal.items;
    expect(
      pension && ['apostille', 'translation', 'validity', 'note'].filter((key) => key in pension),
    ).toEqual([]);
    expect(police).toMatchObject({
      apostille: true,
      translation: 'sworn',
      note: 'Issued by the federal police',
      sources: [{ id: 'law', url: 'https://www.gov.example/law' }],
    });
    expect(police?.traces).toHaveLength(1);
    const consent = result.dependents[1]?.items[1];
    expect(consent?.traces.map((trace) => trace.value)).toEqual([{ type: 'boolean', value: true }]);
  });
});
