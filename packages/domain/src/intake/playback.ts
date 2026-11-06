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
import { languageCodes } from '../case/languages.js';
import {
  type DraftPerson,
  type DraftRelationship,
  type IntakeDraft,
  isNewReference,
} from './draft.js';

/**
 * A draft read back on top of the case (spec 0008, R3). The draft's references are the snapshot's
 * own person IDs for known people, and `n1`, `n2` … for new ones, which cannot collide with the
 * snapshot's `p` IDs.
 */
export interface DescribedDraft {
  /** The case as it would be with the draft applied. */
  readonly snapshot: CaseSnapshot;
  /**
   * What of the draft the case took: the facts it changes, lists as merged with what is stored,
   * and the edges it adds or fills, so a screen saves exactly what the sentences say.
   */
  readonly draft: IntakeDraft;
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

/**
 * A person with the facts a proposal adds: only those the person lacks, and a birth date more
 * precise than the stored one it falls within, so a draft never overwrites what the case holds.
 */
function applyPerson(base: Person, proposed: DraftPerson): Person {
  const { citizenships, languages, birthDate, residenceCountry, educationLevel } = proposed;
  const sharper =
    birthDate !== undefined &&
    (base.birthDate === undefined ||
      (contains(base.birthDate, birthDate) && !contains(birthDate, base.birthDate)));
  const merged: Person = {
    ...base,
    ...(sharper ? { birthDate } : {}),
    ...(residenceCountry === undefined || base.residenceCountry !== undefined
      ? {}
      : { residenceCountry }),
    ...(educationLevel === undefined || base.educationLevel !== undefined
      ? {}
      : { educationLevel }),
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
      (stored) => stored,
    );
  }
  return personSchema.safeParse(merged).success ? merged : base;
}

/** Whether the outer date holds the inner one, such as 1985 for 1985-05-12. */
function contains(outerDate: DateValue, innerDate: DateValue): boolean {
  const outer = dateRange(outerDate);
  const inner = dateRange(innerDate);
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

function snapshotEdge(edge: DraftRelationship): Relationship | undefined {
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
  const [a, b] = edge.people;
  if (a === undefined || b === undefined) return undefined;
  return {
    kind: edge.kind,
    people: [a, b],
    ...(edge.start === undefined ? {} : { start: edge.start }),
  };
}

/** A proposed edge the case holds already, as the details it adds to the stored one only. */
function addedDetails(edge: DraftRelationship, stored: Relationship): DraftRelationship {
  const lacks = (key: string) => !(key in stored);
  if (edge.kind === 'parent') {
    const { parentKind, start, ...ends } = edge;
    return {
      ...ends,
      ...(parentKind !== undefined && lacks('parentKind') ? { parentKind } : {}),
      ...(start !== undefined && lacks('start') ? { start } : {}),
    };
  }
  const { start, ...ends } = edge;
  return { ...ends, ...(start !== undefined && lacks('start') ? { start } : {}) };
}

const draftLanguages: ReadonlySet<string> = new Set(languageCodes);
const isDraftLanguage = (code: string): code is (typeof languageCodes)[number] =>
  draftLanguages.has(code);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The facts the case took for one person, as draft fields: only those that change what is stored.
 * A list holds only the entries it adds or changes, so saving it next to the stored ones keeps
 * their details, such as how a citizenship was acquired.
 */
function takenFacts(proposed: DraftPerson, before: Person | undefined, after: Person): DraftPerson {
  const stored = new Set((before?.citizenships ?? []).map(({ country }) => country));
  const countries = (proposed.citizenships === undefined ? [] : (after.citizenships ?? []))
    .map(({ country }) => country)
    .filter((country) => !stored.has(country));
  const languages = (proposed.languages === undefined ? [] : (after.languages ?? [])).flatMap(
    ({ language, level }) =>
      isDraftLanguage(language) &&
      !(before?.languages ?? []).some((entry) => same(entry, { language, level }))
        ? [{ language, level }]
        : [],
  );
  const changed = (key: keyof Person) =>
    proposed[key as keyof DraftPerson] !== undefined &&
    after[key] !== undefined &&
    !same(after[key], before?.[key]);
  return {
    ref: proposed.ref,
    ...(proposed.role === undefined ? {} : { role: proposed.role }),
    ...(changed('birthDate') && after.birthDate !== undefined
      ? { birthDate: after.birthDate }
      : {}),
    ...(countries.length === 0 ? {} : { citizenships: countries }),
    ...(changed('residenceCountry') && after.residenceCountry !== undefined
      ? { residenceCountry: after.residenceCountry }
      : {}),
    ...(changed('educationLevel') && after.educationLevel !== undefined
      ? { educationLevel: after.educationLevel }
      : {}),
    ...(languages.length === 0 ? {} : { languages }),
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
    .filter(({ ref }) => isNewReference(ref))
    .map((person) => applyPerson({ id: person.ref }, person));
  const fits = (candidate: CaseSnapshot) => caseSnapshotSchema.safeParse(candidate).success;
  const options: CaseSnapshot[] = [
    { ...snapshot, people: [...people, ...added] },
    { ...snapshot, people },
  ];
  let combined = options.find(fits) ?? snapshot;
  const present = new Set(combined.people.map(({ id }) => id));
  const ours = (id: string) => !known.has(id) || kept.has(id);
  const edges: DraftRelationship[] = [];
  for (const edge of draft.relationships) {
    const relationship = snapshotEdge(edge);
    if (relationship === undefined) continue;
    const ends =
      relationship.kind === 'parent'
        ? [relationship.parent, relationship.child]
        : relationship.people;
    // An edge between two people the viewer does not keep is not theirs to propose.
    if (!ends.every((id) => present.has(id)) || !ends.some(ours)) continue;
    const stored = combined.relationships.find((held) => sameEdge(held, relationship));
    const relationships = withEdge(combined.relationships, relationship);
    const next = { ...combined, relationships };
    if (same(relationships, combined.relationships) || !fits(next)) continue;
    combined = next;
    // An edge this draft already proposed takes the details it adds, so each edge is answered once.
    const twin = edges.findIndex((taken) => {
      const earlier = snapshotEdge(taken);
      return earlier !== undefined && sameEdge(earlier, relationship);
    });
    const added = stored === undefined ? edge : addedDetails(edge, stored);
    if (twin === -1) edges.push(added);
    else edges[twin] = { ...added, ...edges[twin] };
  }
  const after = new Map(combined.people.map((person) => [person.id, person]));
  const taken = draft.people.flatMap((person): DraftPerson[] => {
    const now = after.get(person.ref);
    if (now === undefined) return [];
    if (!ours(person.ref)) {
      return [{ ref: person.ref, ...(person.role === undefined ? {} : { role: person.role }) }];
    }
    return [takenFacts(person, known.get(person.ref), now)];
  });
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
  return { snapshot: combined, draft: { people: taken, relationships: edges }, sentences };
}
