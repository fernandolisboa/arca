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

/** A last edge a path crossed to reach someone, and whether the path through it holds. */
export interface Arrival {
  readonly edge: Relationship;
  readonly reached: Truth;
}

/**
 * Someone a relationship path reaches, once, with every last edge it arrived by. Edge facts are
 * read per arrival, so a rule's condition holds for the person when it holds through any of them.
 */
export interface Reached {
  readonly id: string;
  readonly reached: Truth;
  readonly arrivals: readonly Arrival[];
}

/** Someone whose relationships of a kind are not recorded in full, so more people may exist. */
export interface MissingMarker {
  readonly personId: string;
  readonly marker: CompletenessMarker;
}

export interface PathResult {
  readonly reached: readonly Reached[];
  /** People on the way who lack the completeness marker for the next step. */
  readonly missingMarkers: readonly MissingMarker[];
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
  let frontier: Reached[] = [{ id: principalId, reached: true, arrivals: [] }];
  const missingMarkers: MissingMarker[] = [];
  for (const step of steps) {
    const next = new Map<string, Map<Relationship, Truth>>();
    for (const from of frontier) {
      if (!isRecordedInFull(indexed.person(from.id), markers[step])) {
        missingMarkers.push({ personId: from.id, marker: markers[step] });
      }
      for (const neighbor of neighbors(indexed, from.id, step, date)) {
        const reached = and([from.reached, neighbor.valid]);
        if (reached === false) continue;
        const arrivals = next.get(neighbor.id) ?? new Map<Relationship, Truth>();
        const previous = arrivals.get(neighbor.edge);
        arrivals.set(neighbor.edge, previous === undefined ? reached : or([previous, reached]));
        next.set(neighbor.id, arrivals);
      }
    }
    frontier = [...next].map(([id, arrivals]) => ({
      id,
      reached: or([...arrivals.values()]),
      arrivals: [...arrivals].map(([edge, reached]) => ({ edge, reached })),
    }));
  }
  return {
    reached: frontier.filter((entry) => entry.id !== principalId && entry.arrivals.length > 0),
    missingMarkers,
  };
}

/** A line from an ancestor (first) down to the principal (last). */
export interface AncestorLine {
  readonly path: readonly string[];
  readonly valid: Truth;
}

export interface AncestorLines {
  readonly lines: readonly AncestorLine[];
  /** People short of the last generation who lack the `parents` marker. */
  readonly missingMarkers: readonly MissingMarker[];
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
  const missingMarkers: MissingMarker[] = [];
  for (let generation = 1; generation <= generations; generation += 1) {
    const next: AncestorLine[] = [];
    for (const line of frontier) {
      const head = line.path[0] ?? principalId;
      const known = missingMarkers.some((missing) => missing.personId === head);
      if (!known && !isRecordedInFull(indexed.person(head), 'parents')) {
        missingMarkers.push({ personId: head, marker: 'parents' });
      }
      for (const parent of parents(indexed, head, date)) {
        const valid = and([line.valid, parent.valid]);
        if (valid !== false) next.push({ path: [parent.id, ...line.path], valid });
      }
    }
    lines.push(...next);
    frontier = next;
  }
  return { lines, missingMarkers };
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
