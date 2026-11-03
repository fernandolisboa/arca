import type { CalendarDate } from '../calendar/calendar-date.js';
import { type Truth, and, or } from '../logic/truth.js';
import {
  type IndexedSnapshot,
  type MissingMarker,
  type Neighbor,
  children,
  couples,
  isRecordedInFull,
  parents,
} from './graph.js';
import type { CompletenessMarker, Relationship } from './snapshot.js';

export const relationshipSteps = ['spouse', 'partner', 'child', 'parent'] as const;

export type RelationshipStep = (typeof relationshipSteps)[number];

/**
 * Whether a path holds, and when that is unknown, the edges on it whose validity at the date is
 * unknown: the relationships a family can answer about (spec 0002, R5).
 */
export interface Reach {
  readonly reached: Truth;
  readonly uncertainEdges: readonly Relationship[];
}

/** A last edge a path crossed to reach someone, and whether the path through it holds. */
export interface Arrival extends Reach {
  readonly edge: Relationship;
}

/**
 * Someone a relationship path reaches, once, with every last edge it arrived by. Edge facts are
 * read per arrival, so a rule's condition holds for the person when it holds through any of them.
 */
export interface Reached extends Reach {
  readonly id: string;
  readonly arrivals: readonly Arrival[];
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
  let frontier: Reached[] = [{ id: principalId, reached: true, uncertainEdges: [], arrivals: [] }];
  const missingMarkers: MissingMarker[] = [];
  for (const step of steps) {
    const next = new Map<string, Map<Relationship, Reach>>();
    for (const from of frontier) {
      if (!isRecordedInFull(indexed.person(from.id), markers[step])) {
        missingMarkers.push({ personId: from.id, marker: markers[step] });
      }
      for (const neighbor of neighbors(indexed, from.id, step, date)) {
        const reach = cross(from, neighbor);
        if (reach.reached === false) continue;
        const arrivals = next.get(neighbor.id) ?? new Map<Relationship, Reach>();
        arrivals.set(neighbor.edge, join(arrivals.get(neighbor.edge) ?? unreached, reach));
        next.set(neighbor.id, arrivals);
      }
    }
    frontier = [...next].map(([id, arrivals]) => {
      const reach = [...arrivals.values()].reduce<Reach>(join, unreached);
      return { id, ...reach, arrivals: [...arrivals].map(([edge, each]) => ({ edge, ...each })) };
    });
  }
  return {
    reached: frontier.filter((entry) => entry.id !== principalId && entry.arrivals.length > 0),
    missingMarkers,
  };
}

/** A line from an ancestor (first) down to the principal (last). */
export interface AncestorLine extends Reach {
  readonly path: readonly string[];
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
  let frontier: AncestorLine[] = [{ path: [principalId], reached: true, uncertainEdges: [] }];
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
        const reach = cross(line, parent);
        if (reach.reached !== false) next.push({ path: [parent.id, ...line.path], ...reach });
      }
    }
    lines.push(...next);
    frontier = next;
  }
  return { lines, missingMarkers };
}

/** A path extended across one more edge. */
function cross(from: Reach, neighbor: Neighbor): Reach {
  const reached = and([from.reached, neighbor.valid]);
  if (reached !== 'unknown') return { reached, uncertainEdges: [] };
  const crossed = neighbor.valid === 'unknown' ? [neighbor.edge] : [];
  return { reached, uncertainEdges: [...from.uncertainEdges, ...crossed] };
}

const unreached: Reach = { reached: false, uncertainEdges: [] };

/** Two paths to the same place: either may hold. */
function join(left: Reach, right: Reach): Reach {
  const reached = or([left.reached, right.reached]);
  if (reached !== 'unknown') return { reached, uncertainEdges: [] };
  return {
    reached,
    uncertainEdges: [...new Set([...left.uncertainEdges, ...right.uncertainEdges])],
  };
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
