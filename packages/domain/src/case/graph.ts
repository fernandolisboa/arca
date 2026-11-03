import { type CalendarDate, compareDates } from '../calendar/calendar-date.js';
import { compareDateValues } from '../calendar/partial-date.js';
import { type Truth, and } from '../logic/truth.js';
import type { CaseSnapshot, CompletenessMarker, Person, Relationship } from './snapshot.js';

/**
 * A validated snapshot indexed for lookups. `recordedOn` is the date it describes: everyone in it
 * was born, and every recorded adoption had happened, by then.
 */
export interface IndexedSnapshot {
  readonly snapshot: CaseSnapshot;
  readonly recordedOn: CalendarDate;
  readonly person: (id: string) => Person;
}

export function indexSnapshot(snapshot: CaseSnapshot, recordedOn: CalendarDate): IndexedSnapshot {
  const byId = new Map(snapshot.people.map((person) => [person.id, person]));
  return {
    snapshot,
    recordedOn,
    person: (id) => {
      const person = byId.get(id);
      if (person === undefined) throw new RangeError('Unknown person');
      return person;
    },
  };
}

export type CoupleKind = 'spouse' | 'partner';

/** A neighbor across one edge, with whether the edge is valid at the date. */
export interface Neighbor {
  readonly id: string;
  readonly edge: Relationship;
  readonly valid: Truth;
}

/**
 * Whether an edge holds at a date: started on or before it and, for a couple, not ended by it. An
 * unknown start or end makes it unknown. A parent edge has no end. Without a start, a biological
 * link holds from the child's birth and any other from an unknown date no later than
 * `recordedOn`, so it holds from then on and is unknown before (never before the child's birth).
 */
export function edgeValidAt(
  indexed: IndexedSnapshot,
  edge: Relationship,
  date: CalendarDate,
): Truth {
  if (edge.kind === 'parent') {
    if (edge.start !== undefined) return compareDateValues(edge.start, 'lte', date);
    const birth = indexed.person(edge.child).birthDate;
    const born = birth === undefined ? 'unknown' : compareDateValues(birth, 'lte', date);
    if (born === false) return false;
    if (born === true && edge.parentKind === 'biological') return true;
    return compareDates(date, indexed.recordedOn) >= 0 ? true : 'unknown';
  }
  const started = edge.start === undefined ? 'unknown' : compareDateValues(edge.start, 'lte', date);
  const notEnded =
    edge.end === undefined
      ? 'unknown'
      : edge.end === 'none'
        ? true
        : compareDateValues(edge.end, 'gt', date);
  return and([started, notEnded]);
}

export function couples(
  indexed: IndexedSnapshot,
  id: string,
  kind: CoupleKind,
  date: CalendarDate,
): Neighbor[] {
  return indexed.snapshot.relationships.flatMap((edge) => {
    if (edge.kind !== kind || !edge.people.includes(id)) return [];
    const other = edge.people[0] === id ? edge.people[1] : edge.people[0];
    return [{ id: other, edge, valid: edgeValidAt(indexed, edge, date) }];
  });
}

export function parents(indexed: IndexedSnapshot, id: string, date: CalendarDate): Neighbor[] {
  return indexed.snapshot.relationships.flatMap((edge) =>
    edge.kind === 'parent' && edge.child === id
      ? [{ id: edge.parent, edge, valid: edgeValidAt(indexed, edge, date) }]
      : [],
  );
}

export function children(indexed: IndexedSnapshot, id: string, date: CalendarDate): Neighbor[] {
  return indexed.snapshot.relationships.flatMap((edge) =>
    edge.kind === 'parent' && edge.parent === id
      ? [{ id: edge.child, edge, valid: edgeValidAt(indexed, edge, date) }]
      : [],
  );
}

export function isRecordedInFull(person: Person, marker: CompletenessMarker): boolean {
  return person.recordedInFull?.includes(marker) ?? false;
}
