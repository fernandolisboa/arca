/**
 * The family area's tree view: the people in the planning set out by generation, couples side by
 * side, and everyone else apart. Only the parent, spouse and partner relationships the viewer sees
 * place anyone; a person with none starts a generation of their own.
 */
import type { CaseView } from '@arca/api-contract/client';

/** One or two people shown together: a couple, or someone on their own. */
export interface TreeUnit {
  readonly people: readonly string[];
  /** How a couple is joined; absent for someone on their own. */
  readonly bond?: 'spouse' | 'partner';
}

export interface FamilyTree {
  /** Oldest generation first. */
  readonly generations: readonly (readonly TreeUnit[])[];
  /** People outside the planning, in the case's order. */
  readonly outside: readonly string[];
}

export function familyTree(view: CaseView): FamilyTree {
  const order = new Map(view.people.map((person, index) => [person.id, index]));
  const members = new Set(view.people.filter((person) => person.caseMember).map(({ id }) => id));
  const among = view.relationships
    .map(({ relationship }) => relationship)
    .filter(({ from, to }) => members.has(from) && members.has(to));
  const parents = among.filter(({ kind }) => kind === 'parent');
  const couples = among.flatMap(({ kind, from, to }) =>
    kind === 'parent' ? [] : [{ from, to, bond: kind }],
  );

  // A child sits below its parents and a couple shares a row. Each pass can only push a depth
  // down, and a well-formed family settles in fewer passes than it has people; the cap keeps a
  // parent cycle from looping forever.
  const depth = new Map([...members].map((id) => [id, 0]));
  const at = (id: string) => depth.get(id) ?? 0;
  for (let pass = 0; pass < members.size; pass++) {
    let moved = false;
    for (const { from, to } of parents) {
      if (at(to) < at(from) + 1) {
        depth.set(to, at(from) + 1);
        moved = true;
      }
    }
    for (const { from, to } of couples) {
      const shared = Math.max(at(from), at(to));
      if (at(from) !== shared || at(to) !== shared) {
        depth.set(from, shared);
        depth.set(to, shared);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const rows = new Map<number, TreeUnit[]>();
  const placed = new Set<string>();
  const byOrder = [...members].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  for (const id of byOrder) {
    if (placed.has(id)) continue;
    const couple = couples.find(
      ({ from, to }) =>
        (from === id || to === id) && at(from) === at(to) && !placed.has(from === id ? to : from),
    );
    const unit: TreeUnit =
      couple === undefined
        ? { people: [id] }
        : { people: [id, couple.from === id ? couple.to : couple.from], bond: couple.bond };
    unit.people.forEach((person) => placed.add(person));
    rows.set(at(id), [...(rows.get(at(id)) ?? []), unit]);
  }

  // Each row follows the row above: a unit goes under its first parent's unit.
  const generations: TreeUnit[][] = [];
  for (const level of [...rows.keys()].sort((a, b) => a - b)) {
    const above = generations.at(-1) ?? [];
    const column = (unit: TreeUnit) => {
      const index = above.findIndex((upper) =>
        parents.some(({ from, to }) => upper.people.includes(from) && unit.people.includes(to)),
      );
      return index === -1 ? above.length : index;
    };
    const units = rows.get(level) ?? [];
    generations.push(
      units
        .map((unit, index) => ({ unit, index, column: column(unit) }))
        .sort((a, b) => a.column - b.column || a.index - b.index)
        .map(({ unit }) => unit),
    );
  }

  return {
    generations,
    outside: view.people.filter((person) => !person.caseMember).map(({ id }) => id),
  };
}
