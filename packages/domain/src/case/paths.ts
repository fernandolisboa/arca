import type { CalendarDate } from '../calendar/calendar-date.js';
import { type Truth, and, or } from '../logic/truth.js';
import {
  type IndexedSnapshot,
  type Neighbor,
  children,
  couples,
  isRecordedInFull,
  parents,
} from './graph.js';
import type { CompletenessMarker, Relationship } from './snapshot.js';

export const relationshipSteps = ['spouse', 'partner', 'child', 'parent'] as const;

export type RelationshipStep = (typeof relationshipSteps)[number];

/** Someone a relationship path reaches, the last edge crossed, and whether it holds at the date. */
export interface Reached {
  readonly id: string;
  readonly edge: Relationship;
  readonly reached: Truth;
}

export interface PathResult {
  readonly reached: readonly Reached[];
  /** False when someone on the way lacks the completeness marker for the next step. */
  readonly complete: boolean;
}

const markers: Record<RelationshipStep, CompletenessMarker> = {
  spouse: 'spouses',
  partner: 'partners',
  child: 'children',
  parent: 'parents',
};

/**
 * Follows a relationship path such as `spouse.parent` from the principal at a date (spec 0002,
 * R4). Edges certainly invalid at the date are not crossed; an unknown one makes the person
 * reached only possibly. The principal is never returned, and each person and last edge once.
 */
export function followPath(
  indexed: IndexedSnapshot,
  principalId: string,
  steps: readonly RelationshipStep[],
  date: CalendarDate,
): PathResult {
  let frontier: { id: string; edge?: Relationship; reached: Truth }[] = [
    { id: principalId, reached: true },
  ];
  let complete = true;
  for (const step of steps) {
    const next = new Map<string, { id: string; edge: Relationship; reached: Truth }>();
    for (const from of frontier) {
      if (!isRecordedInFull(indexed.person(from.id), markers[step])) complete = false;
      for (const neighbor of neighbors(indexed, from.id, step, date)) {
        const reached = and([from.reached, neighbor.valid]);
        if (reached === false) continue;
        const key = `${neighbor.id}|${String(indexed.snapshot.relationships.indexOf(neighbor.edge))}`;
        const previous = next.get(key);
        next.set(key, {
          id: neighbor.id,
          edge: neighbor.edge,
          reached: previous === undefined ? reached : or([previous.reached, reached]),
        });
      }
    }
    frontier = [...next.values()];
  }
  return {
    reached: frontier.flatMap((entry) =>
      entry.edge === undefined || entry.id === principalId
        ? []
        : [{ id: entry.id, edge: entry.edge, reached: entry.reached }],
    ),
    complete,
  };
}

/** A line from an ancestor (first) down to the principal (last). */
export interface AncestorLine {
  readonly path: readonly string[];
  readonly valid: Truth;
}

export interface AncestorLines {
  readonly lines: readonly AncestorLine[];
  /** False when someone short of the last generation lacks the `parents` marker. */
  readonly complete: boolean;
}

/**
 * Every line from the principal up through parent edges, at most `generations` deep. A person
 * reached through two lines (pedigree collapse) appears once per line, since facts about a line,
 * such as citizenship at the next birth, depend on it.
 */
export function ancestorLines(
  indexed: IndexedSnapshot,
  principalId: string,
  generations: number,
  date: CalendarDate,
): AncestorLines {
  const lines: AncestorLine[] = [];
  let frontier: AncestorLine[] = [{ path: [principalId], valid: true }];
  let complete = true;
  for (let generation = 1; generation <= generations; generation += 1) {
    const next: AncestorLine[] = [];
    for (const line of frontier) {
      const head = line.path[0] ?? principalId;
      if (!isRecordedInFull(indexed.person(head), 'parents')) complete = false;
      for (const parent of parents(indexed, head, date)) {
        const valid = and([line.valid, parent.valid]);
        if (valid !== false) next.push({ path: [parent.id, ...line.path], valid });
      }
    }
    lines.push(...next);
    frontier = next;
  }
  return { lines, complete };
}

function neighbors(
  indexed: IndexedSnapshot,
  id: string,
  step: RelationshipStep,
  date: CalendarDate,
): Neighbor[] {
  switch (step) {
    case 'spouse':
    case 'partner':
      return couples(indexed, id, step, date);
    case 'child':
      return children(indexed, id, date);
    case 'parent':
      return parents(indexed, id, date);
  }
}
