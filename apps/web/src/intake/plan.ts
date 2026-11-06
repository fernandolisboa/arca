import type {
  AnswerCaseQuestionsRequest,
  CaseIntakeDraftResponse,
  CaseQuestions,
  CaseView,
  RouteBody,
  Sentence,
  routes,
} from '@arca/api-contract/client';

/**
 * The intake draft as the screen reviews and saves it (spec 0008, R4). Everything here is pure:
 * the screen keeps the member's choices, and the save runs the writes this plans.
 */

export type IntakeDraft = CaseIntakeDraftResponse['draft'];
type DraftPerson = IntakeDraft['people'][number];
type DraftEdge = IntakeDraft['relationships'][number];
export type NewRelationship = RouteBody<typeof routes.addCaseRelationship>;
export type IntakeList = 'citizenships' | 'languages';

/** One proposed fact or edge, worded as the sentence it would add. */
export interface DraftItem {
  readonly id: string;
  readonly sentence: Sentence;
}

/** A proposed person: kept as new, matched to someone in the case, or dropped. */
export type PersonChoice =
  | { readonly kind: 'new'; readonly displayName: string; readonly caseMember: boolean }
  | { readonly kind: 'match'; readonly personId: string }
  | { readonly kind: 'drop' };

export interface IntakeChoices {
  readonly people: ReadonlyMap<string, PersonChoice>;
  /** The IDs of the facts and edges the member dropped. */
  readonly dropped: ReadonlySet<string>;
  /** The lists the member confirmed whole, as `listId(ref, list)`. */
  readonly whole: ReadonlySet<string>;
}

export const listId = (ref: string, list: IntakeList) => `${ref}:${list}`;
const edgeId = (index: number) => `edge:${String(index)}`;

/** The roles that usually belong to the plan, so a new person with one starts as a member. */
const planRoles: ReadonlySet<string> = new Set(['self', 'spouse', 'partner', 'child']);

/** A person's proposed facts, one sentence each, in the order the guided questions ask them. */
export function personItems(person: DraftPerson): DraftItem[] {
  const { ref } = person;
  const about = [ref];
  const items: DraftItem[] = [];
  if (person.birthDate !== undefined) {
    items.push({
      id: `${ref}:birthDate`,
      sentence: { kind: 'born', about, person: ref, date: person.birthDate },
    });
  }
  for (const country of person.citizenships ?? []) {
    items.push({
      id: `${listId(ref, 'citizenships')}:${country}`,
      sentence: { kind: 'citizenship', about, person: ref, country },
    });
  }
  if (person.residenceCountry !== undefined) {
    items.push({
      id: `${ref}:residenceCountry`,
      sentence: { kind: 'residence', about, person: ref, country: person.residenceCountry },
    });
  }
  if (person.educationLevel !== undefined) {
    items.push({
      id: `${ref}:educationLevel`,
      sentence: { kind: 'education', about, person: ref, level: person.educationLevel },
    });
  }
  for (const { language, level } of person.languages ?? []) {
    items.push({
      id: `${listId(ref, 'languages')}:${language}`,
      sentence: { kind: 'language', about, person: ref, language, level },
    });
  }
  return items;
}

/** The proposed relationships, one sentence each. */
export function edgeItems(draft: IntakeDraft): DraftItem[] {
  return draft.relationships.map((edge, index) => {
    const start = edge.start === undefined ? {} : { start: edge.start };
    if (edge.kind === 'parent') {
      return {
        id: edgeId(index),
        sentence: {
          kind: 'parent',
          about: [edge.parent, edge.child],
          parent: edge.parent,
          child: edge.child,
          ...(edge.parentKind === undefined ? {} : { parentKind: edge.parentKind }),
          ...start,
        },
      };
    }
    const [a = '', b = ''] = edge.people;
    return {
      id: edgeId(index),
      sentence: { kind: 'couple', about: [a, b], couple: edge.kind, people: [a, b], ...start },
    };
  });
}

/**
 * The choices a draft starts with: a known person is themselves, the writer is the viewer's own
 * person, and anyone else is new, unnamed, and a member when their role usually is.
 */
export function defaultChoices(draft: IntakeDraft, view: CaseView): IntakeChoices {
  const known = new Set(view.people.map(({ id }) => id));
  const meNamed = draft.people.some(({ ref }) => ref === view.me);
  const people = new Map<string, PersonChoice>();
  for (const { ref, role } of draft.people) {
    if (known.has(ref)) people.set(ref, { kind: 'match', personId: ref });
    else if (role === 'self' && !meNamed) people.set(ref, { kind: 'match', personId: view.me });
    else people.set(ref, { kind: 'new', displayName: '', caseMember: planRoles.has(role ?? '') });
  }
  return { people, dropped: new Set(), whole: new Set() };
}

/** The new people to create, in draft order, with their names trimmed. */
export function newPeople(draft: IntakeDraft, choices: IntakeChoices) {
  return draft.people.flatMap(({ ref }) => {
    const choice = choices.people.get(ref);
    return choice?.kind === 'new'
      ? [{ ref, displayName: choice.displayName.trim(), caseMember: choice.caseMember }]
      : [];
  });
}

/** Whether every new person has a name the case takes (1 to 80 characters). */
export const namesReady = (draft: IntakeDraft, choices: IntakeChoices) =>
  newPeople(draft, choices).every(
    ({ displayName }) => displayName.length >= 1 && displayName.length <= 80,
  );

export interface IntakeWrites {
  /** One call per person, with the facts and the details of stored relationships. */
  readonly answers: AnswerCaseQuestionsRequest[];
  readonly relationships: NewRelationship[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asList = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

/**
 * The writes that save what the member kept, once the new people exist (`created` maps their
 * draft reference to their case ID). A person matched to someone already in the case only fills
 * the facts that person lacks; a list is saved only when confirmed whole, as the stored entries
 * plus the kept ones (a language the draft restates for the same person replaces its level). An
 * edge the case holds only fills the details it lacks; one with a dropped end, or that would
 * join a person to themselves or two people the viewer does not keep, is left out.
 */
export function intakeWrites(
  draft: IntakeDraft,
  choices: IntakeChoices,
  view: CaseView,
  questions: CaseQuestions,
  created: ReadonlyMap<string, string>,
): IntakeWrites {
  const kept = new Set([
    ...view.people.filter(({ keptByMe }) => keptByMe).map(({ id }) => id),
    ...created.values(),
  ]);
  const resolve = (ref: string): string | undefined => {
    const choice = choices.people.get(ref);
    if (choice?.kind === 'match') return choice.personId;
    return choice?.kind === 'new' ? created.get(ref) : undefined;
  };
  const stored = (personId: string) =>
    new Map(
      (questions.people.find((entry) => entry.personId === personId)?.steps ?? []).flatMap(
        ({ questions: asked }) => asked.map(({ id, answer }) => [id as string, answer] as const),
      ),
    );
  const answers = new Map<string, Map<string, unknown>>();
  const answer = (personId: string, questionId: string, value: unknown) => {
    answers.set(
      personId,
      (answers.get(personId) ?? new Map<string, unknown>()).set(questionId, value),
    );
  };
  const keeps = (id: string) => !choices.dropped.has(id);

  for (const person of draft.people) {
    const personId = resolve(person.ref);
    if (personId === undefined || !kept.has(personId)) continue;
    const before = stored(personId);
    const itself = personId === person.ref || created.has(person.ref);
    const fill = (key: 'birthDate' | 'residenceCountry' | 'educationLevel') => {
      const value = person[key];
      if (value === undefined || !keeps(`${person.ref}:${key}`)) return;
      if (itself || before.get(key) === undefined || before.get(key) === null) {
        answer(personId, key, value);
      }
    };
    fill('birthDate');
    const countries = (person.citizenships ?? []).filter((country) =>
      keeps(`${listId(person.ref, 'citizenships')}:${country}`),
    );
    if (countries.length > 0 && choices.whole.has(listId(person.ref, 'citizenships'))) {
      const list = asList(before.get('citizenships'));
      const held = new Set(list.map(({ country }) => country));
      answer(personId, 'citizenships', [
        ...list,
        ...countries.filter((country) => !held.has(country)).map((country) => ({ country })),
      ]);
    }
    fill('residenceCountry');
    fill('educationLevel');
    const spoken = (person.languages ?? []).filter(({ language }) =>
      keeps(`${listId(person.ref, 'languages')}:${language}`),
    );
    if (spoken.length > 0 && choices.whole.has(listId(person.ref, 'languages'))) {
      const list = asList(before.get('languages'));
      const merged = list.map((entry) => {
        const restated = spoken.find(({ language }) => language === entry['language']);
        return itself && restated !== undefined ? restated : entry;
      });
      const held = new Set(list.map(({ language }) => language));
      answer(personId, 'languages', [
        ...merged,
        ...spoken.filter(({ language }) => !held.has(language)),
      ]);
    }
  }

  const relationships: NewRelationship[] = [];
  const rows = new Map<string, Record<string, unknown>[]>();
  draft.relationships.forEach((edge, index) => {
    if (!keeps(edgeId(index))) return;
    const write = edgeWrite(edge, resolve);
    if (write === undefined || (!kept.has(write.from) && !kept.has(write.to))) return;
    const held = view.relationships.find(({ relationship }) => sameEdge(relationship, write));
    const pending = relationships.find((added) => sameEdge(added, write));
    if (held === undefined && pending === undefined) {
      relationships.push(write);
      return;
    }
    const target = held?.relationship ?? pending;
    if (target === undefined) return;
    const details = lackingDetails(write.details, target.details);
    if (Object.keys(details).length === 0) return;
    if (pending !== undefined) {
      relationships[relationships.indexOf(pending)] = {
        ...pending,
        details: { ...pending.details, ...details },
      };
      return;
    }
    if (held === undefined) return;
    const keeper = kept.has(write.from) ? write.from : write.to;
    const list = rows.get(keeper) ?? asList(stored(keeper).get('relationships'));
    rows.set(
      keeper,
      list.map((row) => (row['id'] === held.id ? { ...row, ...details } : row)),
    );
  });
  for (const [personId, list] of rows) answer(personId, 'relationships', list);

  return {
    answers: [...answers].map(([personId, given]) => ({
      personId,
      answers: [...given].map(([questionId, value]) => ({
        questionId: questionId as AnswerCaseQuestionsRequest['answers'][number]['questionId'],
        answer: value,
      })),
    })),
    relationships,
  };
}

/** The draft edge as a new relationship between case IDs, or `undefined` when an end is gone. */
function edgeWrite(
  edge: DraftEdge,
  resolve: (ref: string) => string | undefined,
): NewRelationship | undefined {
  const [first, second] = edge.kind === 'parent' ? [edge.parent, edge.child] : edge.people;
  const from = first === undefined ? undefined : resolve(first);
  const to = second === undefined ? undefined : resolve(second);
  if (from === undefined || to === undefined || from === to) return undefined;
  const start = edge.start === undefined ? {} : { start: edge.start };
  if (edge.kind === 'parent') {
    const parentKind = edge.parentKind === undefined ? {} : { parentKind: edge.parentKind };
    return { kind: 'parent', from, to, details: { ...parentKind, ...start } };
  }
  return { kind: edge.kind, from, to, details: start };
}

const sameEdge = (a: NewRelationship, b: NewRelationship) =>
  a.kind === b.kind &&
  ((a.from === b.from && a.to === b.to) ||
    (a.kind !== 'parent' && a.from === b.to && a.to === b.from));

const lackingDetails = (proposed: object, held: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(proposed).filter(([key]) => !(key in held)));
