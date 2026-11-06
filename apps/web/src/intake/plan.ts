import {
  isNewReference,
  startsInPlan,
  type AnswerCaseQuestionsRequest,
  type CaseIntakeDraftResponse,
  type CaseQuestions,
  type CaseView,
  type RouteBody,
  type Sentence,
  type routes,
} from '@arca/api-contract/client';
import { isRecord } from '../questions/entry.js';

/**
 * The intake draft as the screen reviews and saves it (spec 0008, R4). The API has already cut the
 * draft to what the case takes, so this only words it, keeps what the member kept, and orders the
 * writes through the existing case routes.
 */

export type IntakeDraft = CaseIntakeDraftResponse['draft'];
type DraftPerson = IntakeDraft['people'][number];
type DraftEdge = IntakeDraft['relationships'][number];
type QuestionId = AnswerCaseQuestionsRequest['answers'][number]['questionId'];
export type NewRelationship = RouteBody<typeof routes.addCaseRelationship>;
export type IntakeList = 'citizenships' | 'languages';

/** One proposed fact or edge, worded as the sentence it would add. */
export interface DraftItem {
  readonly id: string;
  readonly sentence: Sentence;
}

/** A proposed new person: kept, with the name and plan membership the member gives, or dropped. */
export interface NewPerson {
  readonly keep: boolean;
  readonly displayName: string;
  readonly caseMember: boolean;
}

export interface IntakeChoices {
  readonly people: ReadonlyMap<string, NewPerson>;
  /** The IDs of the facts and edges the member dropped. */
  readonly dropped: ReadonlySet<string>;
  /** The lists the member confirmed whole, as `listId(ref, list)`. */
  readonly whole: ReadonlySet<string>;
}

export const listId = (ref: string, list: IntakeList) => `${ref}:${list}`;
const edgeId = (index: number) => `edge:${String(index)}`;

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

/** Every new person starts kept and unnamed, a member when their role usually is. */
export function defaultChoices(draft: IntakeDraft): IntakeChoices {
  return {
    people: new Map(
      draft.people
        .filter(({ ref }) => isNewReference(ref))
        .map(({ ref, role }) => [
          ref,
          { keep: true, displayName: '', caseMember: startsInPlan(role) },
        ]),
    ),
    dropped: new Set(),
    whole: new Set(),
  };
}

/** The new people to create, in draft order, with their names trimmed. */
export function newPeople(draft: IntakeDraft, choices: IntakeChoices) {
  return draft.people.flatMap(({ ref }) => {
    const choice = choices.people.get(ref);
    return choice?.keep === true
      ? [{ ref, displayName: choice.displayName.trim(), caseMember: choice.caseMember }]
      : [];
  });
}

/** Whether every kept new person has a name the case takes (1 to 80 characters). */
export const namesReady = (draft: IntakeDraft, choices: IntakeChoices) =>
  newPeople(draft, choices).every(
    ({ displayName }) => displayName.length >= 1 && displayName.length <= 80,
  );

/** A person's stored answers by question, as the guided questions hold them. */
export function storedAnswers(questions: CaseQuestions, personId: string) {
  return new Map<string, unknown>(
    (questions.people.find((entry) => entry.personId === personId)?.steps ?? []).flatMap(
      ({ questions: asked }) => asked.map(({ id, answer }) => [id, answer] as const),
    ),
  );
}

const asList = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

/** The list entries a save writes: the stored ones, then the kept entries the draft adds. */
export function wholeList(
  person: DraftPerson,
  list: IntakeList,
  choices: IntakeChoices,
  stored: unknown,
): Record<string, unknown>[] {
  const held = asList(stored);
  const key = list === 'citizenships' ? 'country' : 'language';
  const proposed: Record<string, unknown>[] =
    list === 'citizenships'
      ? (person.citizenships ?? []).map((country) => ({ country }))
      : [...(person.languages ?? [])];
  const codes = new Set(held.map((entry) => entry[key]));
  return [
    ...held,
    ...proposed.filter(
      (entry) =>
        !codes.has(entry[key]) &&
        !choices.dropped.has(`${listId(person.ref, list)}:${String(entry[key])}`),
    ),
  ];
}

export interface IntakeWrites {
  /** One call per person: their facts, and the details the draft adds to stored relationships. */
  readonly answers: AnswerCaseQuestionsRequest[];
  readonly relationships: NewRelationship[];
}

/**
 * The writes that save what the member kept, once the new people exist (`created` maps their
 * draft reference to their case ID). A list is saved only when confirmed whole; an edge with a
 * dropped end, or that joins only people the viewer does not keep, is left out. The details of a
 * relationship the case holds go with the answers of the person who keeps one of its ends, since
 * that answer lists the person's relationships as they stand before any new one is added.
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
  const resolve = (ref: string) => (isNewReference(ref) ? created.get(ref) : ref);
  const keeps = (id: string) => !choices.dropped.has(id);
  const answers = new Map<string, Map<QuestionId, unknown>>();
  const answer = (personId: string, questionId: QuestionId, value: unknown) => {
    answers.set(
      personId,
      (answers.get(personId) ?? new Map<QuestionId, unknown>()).set(questionId, value),
    );
  };

  for (const person of draft.people) {
    const personId = resolve(person.ref);
    if (personId === undefined || !kept.has(personId)) continue;
    const stored = storedAnswers(questions, personId);
    for (const key of ['birthDate', 'residenceCountry', 'educationLevel'] as const) {
      const value = person[key];
      if (value !== undefined && keeps(`${person.ref}:${key}`)) answer(personId, key, value);
    }
    for (const list of ['citizenships', 'languages'] as const) {
      const proposed = personItems(person).some(
        ({ id }) => id.startsWith(`${listId(person.ref, list)}:`) && keeps(id),
      );
      if (proposed && choices.whole.has(listId(person.ref, list))) {
        answer(personId, list, wholeList(person, list, choices, stored.get(list)));
      }
    }
  }

  const relationships: NewRelationship[] = [];
  const rows = new Map<string, Record<string, unknown>[]>();
  draft.relationships.forEach((edge, index) => {
    if (!keeps(edgeId(index))) return;
    const write = edgeWrite(edge, resolve);
    if (write === undefined || (!kept.has(write.from) && !kept.has(write.to))) return;
    const held = view.relationships.find(({ relationship }) => sameEdge(relationship, write));
    if (held === undefined) {
      relationships.push(write);
      return;
    }
    const keeper = kept.has(write.from) ? write.from : write.to;
    const list = rows.get(keeper) ?? asList(storedAnswers(questions, keeper).get('relationships'));
    rows.set(
      keeper,
      list.map((row) => (row['id'] === held.id ? { ...row, ...write.details } : row)),
    );
  });
  for (const [personId, list] of rows) answer(personId, 'relationships', list);

  return {
    answers: [...answers].map(([personId, given]) => ({
      personId,
      answers: [...given].map(([questionId, value]) => ({ questionId, answer: value })),
    })),
    relationships,
  };
}

/** The draft edge as a relationship between case IDs, or `undefined` when an end is dropped. */
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
