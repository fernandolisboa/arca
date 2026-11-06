/**
 * Scores a draft against the expected one (spec 0008, R5). Every proposed fact is one key; a key
 * in both drafts is a hit, one only proposed is wrong (against precision), one only expected is
 * missed (against recall). A new person is matched to the expected new person they best agree
 * with, since the model may number them in another order.
 */
import { type IntakeDraft, isNewReference, renameDraft } from '@arca/domain';

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
  readonly wrong: string[];
  readonly missed: string[];
}

export const emptyTally = (): Tally => ({ hits: 0, wrong: 0, missed: 0 });
export const emptyFields = () =>
  Object.fromEntries(fields.map((field) => [field, emptyTally()])) as Record<Field, Tally>;

/** A proposed new person no expected one matches. */
const extra = (ref: string) => `extra:${ref}`;
const isNew = (ref: string) => isNewReference(ref) || ref.startsWith(extra(''));

/** Every fact of a draft, once each, as `field: key`. A role counts unless the case leaves it open. */
export function factsOf(
  draft: IntakeDraft,
  unscoredRoles: ReadonlySet<string>,
): Map<string, Field> {
  const facts = new Map<string, Field>();
  const add = (field: Field, key: string) => facts.set(`${field}: ${key}`, field);
  for (const person of draft.people) {
    const { ref } = person;
    if (isNew(ref)) {
      add('people', ref);
      if (person.role !== undefined && !unscoredRoles.has(ref))
        add('role', `${ref} ${person.role}`);
    }
    if (person.birthDate !== undefined) add('birthDate', `${ref} ${person.birthDate}`);
    for (const country of person.citizenships ?? []) add('citizenships', `${ref} ${country}`);
    if (person.residenceCountry !== undefined) {
      add('residenceCountry', `${ref} ${person.residenceCountry}`);
    }
    if (person.educationLevel !== undefined) {
      add('educationLevel', `${ref} ${String(person.educationLevel)}`);
    }
    for (const { language, level } of person.languages ?? []) {
      add('languages', `${ref} ${language} ${level}`);
    }
  }
  for (const edge of draft.relationships) {
    const key =
      edge.kind === 'parent'
        ? `parent ${edge.parent} > ${edge.child}`
        : `${edge.kind} ${[...edge.people].sort().join(' + ')}`;
    add('relationships', key);
    if (edge.kind === 'parent' && edge.parentKind !== undefined) {
      add('relationshipDetails', `${key} ${edge.parentKind}`);
    }
    if (edge.start !== undefined) add('relationshipDetails', `${key} since ${edge.start}`);
  }
  return facts;
}

function compare(
  actual: IntakeDraft,
  expected: IntakeDraft,
  unscoredRoles: ReadonlySet<string>,
): CaseScore {
  const proposed = factsOf(actual, unscoredRoles);
  const wanted = factsOf(expected, unscoredRoles);
  const byField = emptyFields();
  const wrong: string[] = [];
  const missed: string[] = [];
  for (const [key, field] of proposed) {
    if (wanted.has(key)) byField[field].hits += 1;
    else {
      byField[field].wrong += 1;
      wrong.push(key);
    }
  }
  for (const [key, field] of wanted) {
    if (!proposed.has(key)) {
      byField[field].missed += 1;
      missed.push(key);
    }
  }
  return { byField, wrong, missed };
}

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

/** Beyond this many new people, they are matched in the order the draft lists them. */
const maxMatched = 7;

/**
 * The score of `actual` against `expected` under the matching of new people with the most hits,
 * then the fewest wrong facts; a proposed new person no expected one matches is extra.
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
    const matched = new Map(proposedNew.map((ref, index) => [ref, order[index] ?? extra(ref)]));
    const score = compare(
      renameDraft(actual, (ref) => matched.get(ref) ?? ref),
      expected,
      unscoredRoles,
    );
    if (best === undefined || better(score, best)) best = score;
  }
  return best ?? compare(actual, expected, unscoredRoles);
}

const better = (a: CaseScore, b: CaseScore) =>
  a.missed.length !== b.missed.length
    ? a.missed.length < b.missed.length
    : a.wrong.length < b.wrong.length;

/** The wrong facts a case forbids outright, by key prefix such as `citizenships: `. */
export const forbiddenIn = (score: CaseScore, forbidden: readonly string[]): string[] =>
  score.wrong.filter((key) => forbidden.some((prefix) => key.startsWith(prefix)));

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
