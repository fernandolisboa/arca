import { type CalendarDate, compareDates } from '../calendar/calendar-date.js';
import { type DateValue, dateRange } from '../calendar/partial-date.js';
import { type PlaybackVisibility, type Sentence, describeCase } from '../case/playback.js';
import {
  type CaseSnapshot,
  type Person,
  type Relationship,
  caseSnapshotSchema,
  personSchema,
} from '../case/snapshot.js';
import type { DraftPerson, DraftRelationship, IntakeDraft } from './draft.js';

/**
 * A draft read back on top of the case (spec 0008, R3). The draft's references are the snapshot's
 * own person IDs for known people, and `n1`, `n2` … for new ones, which cannot collide with the
 * snapshot's `p` IDs.
 */
export interface DescribedDraft {
  /** The case as it would be with the draft applied. */
  readonly snapshot: CaseSnapshot;
  /** The sentences the draft adds or changes. */
  readonly sentences: Sentence[];
}

const silentKinds: ReadonlySet<Sentence['kind']> = new Set([
  'unanswered',
  'profileHidden',
  'financesHidden',
]);

/** A stored list merged with a proposed one by key: a stored entry keeps its details. */
function mergeBy<Item>(
  stored: readonly Item[] | undefined,
  proposed: readonly Item[],
  key: (item: Item) => string,
  replace: (stored: Item, proposed: Item) => Item,
): Item[] {
  const merged = [...(stored ?? [])];
  for (const item of proposed) {
    const at = merged.findIndex((entry) => key(entry) === key(item));
    if (at === -1) merged.push(item);
    else merged[at] = replace(merged[at] as Item, item);
  }
  return merged;
}

function applyPerson(base: Person, proposed: DraftPerson): Person {
  const { citizenships, languages, birthDate, residenceCountry, educationLevel } = proposed;
  const merged: Person = {
    ...base,
    ...(birthDate === undefined || contains(birthDate, base.birthDate) ? {} : { birthDate }),
    ...(residenceCountry === undefined ? {} : { residenceCountry }),
    ...(educationLevel === undefined ? {} : { educationLevel }),
  };
  if (citizenships !== undefined) {
    merged.citizenships = mergeBy(
      base.citizenships,
      citizenships.map((country) => ({ country })),
      ({ country }) => country,
      (stored) => stored,
    );
  }
  if (languages !== undefined) {
    merged.languages = mergeBy(
      base.languages,
      languages,
      ({ language }) => language,
      (_, next) => next,
    );
  }
  return personSchema.safeParse(merged).success ? merged : base;
}

/** Whether a proposed date only restates a stored one less precisely, such as 1985 for 1985-05-12. */
function contains(proposed: DateValue, stored: DateValue | undefined): boolean {
  if (stored === undefined) return false;
  const outer = dateRange(proposed);
  const inner = dateRange(stored);
  return compareDates(outer.min, inner.min) <= 0 && compareDates(inner.max, outer.max) <= 0;
}

const sameEdge = (a: Relationship, b: Relationship): boolean =>
  a.kind === 'parent'
    ? b.kind === 'parent' && a.parent === b.parent && a.child === b.child
    : b.kind === a.kind && [...a.people].sort().join(':') === [...b.people].sort().join(':');

/**
 * A proposed edge the case already holds only fills the details it lacks, such as a start date,
 * and never changes one it has, so a restated marriage is not read as a second one.
 */
function withEdge(relationships: readonly Relationship[], proposed: Relationship): Relationship[] {
  const stored = relationships.find((edge) => sameEdge(edge, proposed));
  if (stored === undefined) return [...relationships, proposed];
  const filled = { ...proposed, ...stored };
  return relationships.map((edge) => (edge === stored ? filled : edge));
}

function snapshotEdge(edge: DraftRelationship): Relationship {
  if (edge.kind === 'parent') {
    const { parent, child, parentKind, start } = edge;
    return {
      kind: 'parent',
      parent,
      child,
      ...(parentKind === undefined ? {} : { parentKind }),
      ...(start === undefined ? {} : { start }),
    };
  }
  return {
    kind: edge.kind,
    people: edge.people,
    ...(edge.start === undefined ? {} : { start: edge.start }),
  };
}

const counted = (sentences: readonly Sentence[]) => {
  const counts = new Map<string, number>();
  for (const said of sentences) {
    const key = JSON.stringify(said);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

/**
 * The draft applied on top of the viewer's snapshot, and the sentences it adds or changes. Facts
 * about a known person the viewer does not keep are dropped; lists merge with what is stored; all new
 * people are left out when they would break the case's limits; an edge the case holds only fills what it
 * lacks, and one that would break the snapshot's checks (a cycle, a fifth parent) is dropped.
 * Nothing is written.
 */
export function describeDraft(
  snapshot: CaseSnapshot,
  draft: IntakeDraft,
  kept: ReadonlySet<string>,
  visibility: PlaybackVisibility,
  at: CalendarDate,
): DescribedDraft {
  const known = new Map(snapshot.people.map((person) => [person.id, person]));
  const proposed = new Map(draft.people.map((person) => [person.ref, person]));
  const people = snapshot.people.map((person) => {
    const next = proposed.get(person.id);
    return next === undefined || !kept.has(person.id) ? person : applyPerson(person, next);
  });
  const added = draft.people
    .filter(({ ref }) => /^n[0-9]+$/.test(ref))
    .map((person) => applyPerson({ id: person.ref }, person));
  const fits = (candidate: CaseSnapshot) => caseSnapshotSchema.safeParse(candidate).success;
  const options: CaseSnapshot[] = [
    { ...snapshot, people: [...people, ...added] },
    { ...snapshot, people },
  ];
  let combined = options.find(fits) ?? snapshot;
  const present = new Set(combined.people.map(({ id }) => id));
  for (const edge of draft.relationships) {
    const relationship = snapshotEdge(edge);
    const ends =
      relationship.kind === 'parent'
        ? [relationship.parent, relationship.child]
        : relationship.people;
    if (!ends.every((id) => present.has(id))) continue;
    const next = { ...combined, relationships: withEdge(combined.relationships, relationship) };
    if (fits(next)) combined = next;
  }
  const seen = new Map(visibility);
  for (const person of combined.people) {
    if (!known.has(person.id)) seen.set(person.id, { profile: true, finances: false });
  }
  const before = counted(describeCase(snapshot, visibility, at));
  const sentences = describeCase(combined, seen, at).filter((said) => {
    if (silentKinds.has(said.kind)) return false;
    const key = JSON.stringify(said);
    const left = before.get(key) ?? 0;
    if (left === 0) return true;
    before.set(key, left - 1);
    return false;
  });
  return { snapshot: combined, sentences };
}
