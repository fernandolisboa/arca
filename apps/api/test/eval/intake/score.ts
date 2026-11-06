import { type IntakeDraft, isNewReference } from '@arca/domain';

/**
 * Scores a draft against the expected one (spec 0008, R5). Every proposed fact is one key; a key
 * in both drafts is a hit, one only proposed is wrong (against precision), one only expected is
 * missed (against recall). A new person is matched to the expected new person they best agree
 * with, since the model may number them in another order.
 */

export const fields = [
  'people',
  'role',
  'birthDate',
  'citizenships',
  'residenceCountry',
  'educationLevel',
  'languages',
  'relationships',
  'relationshipDetails',
] as const;
export type Field = (typeof fields)[number];

export interface Tally {
  hits: number;
  wrong: number;
  missed: number;
}

export interface CaseScore {
  readonly byField: Record<Field, Tally>;
  /** The keys proposed that the expected draft does not hold. */
  readonly wrong: string[];
  /** The keys expected that the draft does not hold. */
  readonly missed: string[];
}

export const emptyTally = (): Tally => ({ hits: 0, wrong: 0, missed: 0 });
const emptyFields = () =>
  Object.fromEntries(fields.map((field) => [field, emptyTally()])) as Record<Field, Tally>;

type Fact = readonly [Field, string];

/** Every fact of a draft as a key. A new person's role is scored only when the case expects one. */
export function factsOf(draft: IntakeDraft, unscoredRoles: ReadonlySet<string>): Fact[] {
  const facts: Fact[] = [];
  for (const person of draft.people) {
    const { ref } = person;
    const isNew = isNewReference(ref) || ref.startsWith('extra:');
    if (isNew) facts.push(['people', ref]);
    if (person.role !== undefined && isNew && !unscoredRoles.has(ref)) {
      facts.push(['role', `${ref} ${person.role}`]);
    }
    if (person.birthDate !== undefined) facts.push(['birthDate', `${ref} ${person.birthDate}`]);
    for (const country of person.citizenships ?? []) {
      facts.push(['citizenships', `${ref} ${country}`]);
    }
    if (person.residenceCountry !== undefined) {
      facts.push(['residenceCountry', `${ref} ${person.residenceCountry}`]);
    }
    if (person.educationLevel !== undefined) {
      facts.push(['educationLevel', `${ref} ${String(person.educationLevel)}`]);
    }
    for (const { language, level } of person.languages ?? []) {
      facts.push(['languages', `${ref} ${language} ${level}`]);
    }
  }
  for (const edge of draft.relationships) {
    const key =
      edge.kind === 'parent'
        ? `parent ${edge.parent} > ${edge.child}`
        : `${edge.kind} ${[...edge.people].sort().join(' + ')}`;
    facts.push(['relationships', key]);
    if (edge.kind === 'parent' && edge.parentKind !== undefined) {
      facts.push(['relationshipDetails', `${key} ${edge.parentKind}`]);
    }
    if (edge.start !== undefined) facts.push(['relationshipDetails', `${key} since ${edge.start}`]);
  }
  return facts;
}

const keyOf = ([field, key]: Fact) => `${field}: ${key}`;

function compare(
  actual: IntakeDraft,
  expected: IntakeDraft,
  unscoredRoles: ReadonlySet<string>,
): CaseScore {
  const proposed = new Set(factsOf(actual, unscoredRoles).map(keyOf));
  const wanted = new Set(factsOf(expected, unscoredRoles).map(keyOf));
  const byField = emptyFields();
  const wrong: string[] = [];
  const missed: string[] = [];
  for (const fact of factsOf(actual, unscoredRoles)) {
    const key = keyOf(fact);
    if (wanted.has(key)) byField[fact[0]].hits += 1;
    else {
      byField[fact[0]].wrong += 1;
      wrong.push(key);
    }
  }
  for (const fact of factsOf(expected, unscoredRoles)) {
    const key = keyOf(fact);
    if (!proposed.has(key)) {
      byField[fact[0]].missed += 1;
      missed.push(key);
    }
  }
  return { byField, wrong, missed };
}

const rename = (draft: IntakeDraft, to: (ref: string) => string): IntakeDraft => ({
  people: draft.people.map((person) => ({ ...person, ref: to(person.ref) })),
  relationships: draft.relationships.map((edge) =>
    edge.kind === 'parent'
      ? { ...edge, parent: to(edge.parent), child: to(edge.child) }
      : { ...edge, people: edge.people.map(to) },
  ),
});

const hitsOf = (score: CaseScore) =>
  fields.reduce((sum, field) => sum + score.byField[field].hits, 0);

function* arrangements<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (const [index, item] of items.entries()) {
    for (const rest of arrangements([...items.slice(0, index), ...items.slice(index + 1)])) {
      yield [item, ...rest];
    }
  }
}

/** Beyond this many new people, they are matched in the order the model numbered them. */
const maxMatched = 7;

/**
 * The score of `actual` against `expected` under the matching of new people with the most hits;
 * a tie keeps the model's own numbering. A proposed new person no expected one matches is extra.
 */
export function scoreDraft(
  actual: IntakeDraft,
  expected: IntakeDraft,
  unscoredRoles: ReadonlySet<string> = new Set(),
): CaseScore {
  const proposedNew = actual.people.map(({ ref }) => ref).filter(isNewReference);
  const expectedNew = expected.people.map(({ ref }) => ref).filter(isNewReference);
  const slots = Math.max(proposedNew.length, expectedNew.length);
  const targets: (string | undefined)[] = [
    ...expectedNew,
    ...Array<undefined>(slots - expectedNew.length).fill(undefined),
  ];
  const orders = slots > maxMatched ? [targets] : arrangements(targets);
  let best: CaseScore | undefined;
  for (const order of orders) {
    const matched = new Map(
      proposedNew.map((ref, index) => [ref, order[index] ?? `extra:${ref}`] as const),
    );
    const score = compare(
      rename(actual, (ref) => matched.get(ref) ?? ref),
      expected,
      unscoredRoles,
    );
    if (best === undefined || hitsOf(score) > hitsOf(best)) best = score;
  }
  return best ?? compare(actual, expected, unscoredRoles);
}

/** Every case's tallies summed per field and in all. */
export function totals(scores: readonly CaseScore[]): Record<Field | 'all', Tally> {
  const sum = { ...emptyFields(), all: emptyTally() };
  for (const score of scores) {
    for (const field of fields) {
      const tally = score.byField[field];
      for (const target of [sum[field], sum.all]) {
        target.hits += tally.hits;
        target.wrong += tally.wrong;
        target.missed += tally.missed;
      }
    }
  }
  return sum;
}

/** The share of proposed facts that are right; 1 when nothing was proposed. */
export const precision = ({ hits, wrong }: Tally) =>
  hits + wrong === 0 ? 1 : hits / (hits + wrong);
/** The share of expected facts proposed; 1 when nothing was expected. */
export const recall = ({ hits, missed }: Tally) =>
  hits + missed === 0 ? 1 : hits / (hits + missed);
/** One figure where a wrong fact costs twice what a missed one does. */
export const weighted = ({ hits, wrong, missed }: Tally) =>
  hits + wrong + missed === 0 ? 1 : hits / (hits + 2 * wrong + missed);
