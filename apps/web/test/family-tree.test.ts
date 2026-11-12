import type { CasePerson, CaseRelationship, CaseView } from '@arca/api-contract/client';
import { describe, expect, it } from 'vitest';
import { familyTree } from '../src/family-tree.js';

/** Synthetic IDs only. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [ana, bruno, clara, davi, lucia, rui, eva] = [1, 2, 3, 4, 5, 6, 7].map(id) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

const person = (personId: string, caseMember = true): CasePerson => ({
  id: personId,
  displayName: 'Pessoa',
  caseMember,
  accountId: null,
  keptByMe: true,
  profile: null,
  finances: null,
  shares: null,
  sharedWithMe: [],
});

let next = 100;
const edge = (
  kind: CaseRelationship['relationship']['kind'],
  from: string,
  to: string,
): CaseRelationship => ({
  id: id(next++),
  editable: true,
  relationship: { kind, from, to, details: {} },
});

const viewOf = (people: readonly CasePerson[], relationships: readonly CaseRelationship[]) =>
  ({ caseId: id(99), me: ana, people, relationships }) as CaseView;

describe('familyTree', () => {
  it('puts a couple on one row and their children below', () => {
    const tree = familyTree(
      viewOf(
        [ana, bruno, clara, davi].map((p) => person(p)),
        [
          edge('spouse', ana, bruno),
          edge('parent', ana, clara),
          edge('parent', bruno, clara),
          edge('parent', ana, davi),
        ],
      ),
    );
    expect(tree.generations).toEqual([
      [{ people: [ana, bruno], bond: 'spouse' }],
      [{ people: [clara] }, { people: [davi] }],
    ]);
    expect(tree.outside).toEqual([]);
  });

  it('keeps people outside the planning apart, and their relationships out of the tree', () => {
    const tree = familyTree(
      viewOf(
        [person(ana), person(lucia, false), person(clara)],
        [edge('parent', lucia, ana), edge('parent', ana, clara)],
      ),
    );
    expect(tree.generations).toEqual([[{ people: [ana] }], [{ people: [clara] }]]);
    expect(tree.outside).toEqual([lucia]);
  });

  it('lifts a partner to the row of the one with parents, and their child with them', () => {
    // Rui is Ana's child; Eva, his partner, has no parents in the case.
    const tree = familyTree(
      viewOf(
        [ana, eva, rui, clara].map((p) => person(p)),
        [edge('parent', ana, rui), edge('partner', eva, rui), edge('parent', eva, clara)],
      ),
    );
    expect(tree.generations).toEqual([
      [{ people: [ana] }],
      [{ people: [eva, rui], bond: 'partner' }],
      [{ people: [clara] }],
    ]);
  });

  it('orders a row by the units above it, then by the case order', () => {
    const tree = familyTree(
      viewOf(
        [ana, bruno, davi, clara].map((p) => person(p)),
        [edge('parent', bruno, davi), edge('parent', ana, clara)],
      ),
    );
    expect(tree.generations).toEqual([
      [{ people: [ana] }, { people: [bruno] }],
      [{ people: [clara] }, { people: [davi] }],
    ]);
  });

  it('shows someone with no relationships on the first row', () => {
    expect(familyTree(viewOf([person(ana)], [])).generations).toEqual([[{ people: [ana] }]]);
  });
});
