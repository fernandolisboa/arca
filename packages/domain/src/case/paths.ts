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

/**
 * How a path arrived at someone, by its last edge and, when kept, its first edge, the only edges a
 * condition reads, and whether some walk through them holds.
 */
export interface Arrival extends Reach {
  /** The last edge, the one `edge.*` facts read. */
  readonly edge: Relationship;
  /** The edge that left the principal, the one `firstEdge.*` facts read, when asked for. */
  readonly firstEdge?: Relationship;
}

/**
 * Someone a relationship path reaches, once, with every last edge (and kept first edge) it arrived
 * by. Edge facts are read per arrival, so a rule's condition holds for the person when it holds
 * through any of them.
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

interface Walk extends Reach {
  readonly id: string;
  readonly firstEdge?: Relationship;
  readonly edge: Relationship;
}

/**
 * Follows a relationship path such as `spouse.parent` from the principal at a date (spec 0002,
 * R4). Edges certainly invalid at the date are not crossed; an unknown one makes the person
 * reached only possibly. The principal is never returned, and each person once. Walks are merged
 * at every step on the person and, when `keepFirstEdge` asks for it, the first edge; only the last
 * step also keeps the last edge apart. So without first edges the work is bounded by the edges,
 * as before, and with them by the first edges times the edges.
 */
export function followPath(
  indexed: IndexedSnapshot,
  principalId: string,
  steps: readonly RelationshipStep[],
  date: CalendarDate,
  keepFirstEdge = false,
): PathResult {
  let walks: readonly (Omit<Walk, 'edge'> & { edge?: Relationship })[] = [
    { id: principalId, reached: true, uncertainEdges: [] },
  ];
  const missingMarkers = new Map<string, MissingMarker>();
  const edgeIndex = new Map(indexed.snapshot.relationships.map((edge, at) => [edge, at]));
  const keyOf = (edge: Relationship | undefined): string =>
    edge === undefined ? '' : String(edgeIndex.get(edge));
  for (const [index, step] of steps.entries()) {
    const last = index === steps.length - 1;
    const next = new Map<string, Walk>();
    for (const walk of walks) {
      if (!isRecordedInFull(indexed.person(walk.id), markers[step])) {
        missingMarkers.set(`${walk.id}:${markers[step]}`, {
          personId: walk.id,
          marker: markers[step],
        });
      }
      for (const neighbor of neighbors(indexed, walk.id, step, date)) {
        const reach = cross(walk, neighbor);
        if (reach.reached === false) continue;
        const firstEdge = keepFirstEdge ? (walk.firstEdge ?? neighbor.edge) : undefined;
        const key = [neighbor.id, keyOf(firstEdge), last ? keyOf(neighbor.edge) : ''].join('|');
        const merged = join(next.get(key) ?? unreached, reach);
        next.set(key, {
          id: neighbor.id,
          ...merged,
          ...(firstEdge === undefined ? {} : { firstEdge }),
          edge: neighbor.edge,
        });
      }
    }
    walks = [...next.values()];
  }
  const byPerson = new Map<string, Arrival[]>();
  for (const { id, firstEdge, edge, ...reach } of walks) {
    if (id === principalId || edge === undefined) continue;
    const arrivals = byPerson.get(id) ?? [];
    arrivals.push({ ...reach, edge, ...(firstEdge === undefined ? {} : { firstEdge }) });
    byPerson.set(id, arrivals);
  }
  return {
    reached: [...byPerson].map(([id, arrivals]) => ({
      id,
      ...arrivals.reduce<Reach>(join, unreached),
      arrivals,
    })),
    missingMarkers: [...missingMarkers.values()],
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
