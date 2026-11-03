import { type CalendarDate, compareDates } from '../calendar/calendar-date.js';
import { type DateValue, compareDateValues, dateRange } from '../calendar/partial-date.js';
import { type Interval, type Truth, and, compareIntervals } from '../logic/truth.js';
import type { CaseSnapshot, CompletenessMarker, Person, Relationship } from './snapshot.js';

/** A validated snapshot indexed for lookups. */
export interface IndexedSnapshot {
  readonly snapshot: CaseSnapshot;
  readonly person: (id: string) => Person;
}

export function indexSnapshot(snapshot: CaseSnapshot): IndexedSnapshot {
  const byId = new Map(snapshot.people.map((person) => [person.id, person]));
  return {
    snapshot,
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
 * unknown start or end makes it unknown. A parent edge has no end, and without a start (a
 * biological link) it always holds.
 */
export function edgeValidAt(edge: Relationship, date: CalendarDate): Truth {
  const started =
    edge.start === undefined
      ? edge.kind === 'parent'
        ? true
        : 'unknown'
      : compareDateValues(edge.start, 'lte', date);
  if (edge.kind === 'parent') return started;
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
    return [{ id: other, edge, valid: edgeValidAt(edge, date) }];
  });
}

export function parents(indexed: IndexedSnapshot, id: string, date: CalendarDate): Neighbor[] {
  return indexed.snapshot.relationships.flatMap((edge) =>
    edge.kind === 'parent' && edge.child === id
      ? [{ id: edge.parent, edge, valid: edgeValidAt(edge, date) }]
      : [],
  );
}

export function children(indexed: IndexedSnapshot, id: string, date: CalendarDate): Neighbor[] {
  return indexed.snapshot.relationships.flatMap((edge) =>
    edge.kind === 'parent' && edge.parent === id
      ? [{ id: edge.child, edge, valid: edgeValidAt(edge, date) }]
      : [],
  );
}

export function isRecordedInFull(person: Person, marker: CompletenessMarker): boolean {
  return person.recordedInFull?.includes(marker) ?? false;
}

/** Whether a possibly partial date falls on or before every date in an interval. */
export function onOrBefore(value: DateValue, interval: Interval<CalendarDate>): Truth {
  return compareIntervals(dateRange(value), 'lte', interval, compareDates);
}

/** Whether a possibly partial date falls after every date in an interval. */
export function after(value: DateValue, interval: Interval<CalendarDate>): Truth {
  return compareIntervals(dateRange(value), 'gt', interval, compareDates);
}
