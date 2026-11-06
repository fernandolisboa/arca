import type { CaseQuestions, CaseView } from '@arca/api-contract/client';
import { describe, expect, it } from 'vitest';
import {
  type IntakeChoices,
  type IntakeDraft,
  defaultChoices,
  edgeItems,
  intakeWrites,
  listId,
  namesReady,
  newPeople,
  personItems,
} from '../src/intake/plan.js';
import { type IntakeCalls, freshProgress, saveIntake } from '../src/intake/save.js';

// The intake screen's save plan (spec 0008, R4). Synthetic people only.
const me = '0b9c3d6e-1f2a-4b5c-8d7e-9f0a1b2c3d4e';
const bruna = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const caio = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';
const edge = '3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b';

const person = (id: string, displayName: string, keptByMe = true) => ({
  id,
  displayName,
  caseMember: true,
  accountId: null,
  keptByMe,
  profile: null,
  finances: null,
  shares: null,
  sharedWithMe: [],
});

const view: CaseView = {
  caseId: '4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c',
  me,
  people: [person(me, 'Alice'), person(bruna, 'Bruna'), person(caio, 'Caio', false)],
  relationships: [
    {
      id: edge,
      editable: true,
      relationship: { kind: 'parent', from: me, to: bruna, details: { parentKind: 'biological' } },
    },
  ],
  assets: [],
};

/** Stored answers by person and question. */
function questionsWith(answers: Record<string, Record<string, unknown>>): CaseQuestions {
  return {
    people: [me, bruna].map((personId) => ({
      personId,
      steps: [
        {
          id: 'basics',
          questions: Object.entries(answers[personId] ?? {}).map(([id, answer]) => ({
            id: id as 'birthDate',
            answer,
          })),
        },
      ],
    })),
    countries: ['BR', 'IT', 'PT', 'US'],
    formerCountries: [],
  };
}

const empty = questionsWith({});

/** A draft as the API answers it; its dates are plain strings here. */
const draftOf = (draft: unknown) => draft as IntakeDraft;

const dropped = { keep: false, displayName: '', caseMember: false };

/** The default choices with the new people named and the changes given. */
function choose(
  draft: IntakeDraft,
  names: Record<string, string>,
  change: Partial<IntakeChoices> = {},
): IntakeChoices {
  const base = defaultChoices(draft);
  const people = new Map(
    [...base.people].map(([ref, choice]) => [ref, { ...choice, displayName: names[ref] ?? '' }]),
  );
  return { ...base, people, ...change };
}

describe('the intake save plan (spec 0008, R4)', () => {
  const draft = draftOf({
    people: [
      { ref: me, role: 'self', birthDate: '1985' },
      { ref: bruna, role: 'child', citizenships: ['IT'] },
      {
        ref: 'n1',
        role: 'spouse',
        citizenships: ['IT'],
        languages: [{ language: 'it', level: 'native' }],
      },
      { ref: 'n2', role: 'grandparent' },
    ],
    relationships: [
      { kind: 'spouse', people: [me, 'n1'], start: '2010' },
      { kind: 'parent', parent: 'n1', child: bruna },
    ],
  });

  it('starts every new person kept and unnamed, in the plan by role', () => {
    expect([...defaultChoices(draft).people]).toEqual([
      ['n1', { keep: true, displayName: '', caseMember: true }],
      ['n2', { keep: true, displayName: '', caseMember: false }],
    ]);
  });

  it('words each fact and edge as the sentence it adds', () => {
    expect(personItems(draft.people[2] ?? { ref: '' })).toEqual([
      {
        id: 'n1:citizenships:IT',
        sentence: { kind: 'citizenship', about: ['n1'], person: 'n1', country: 'IT' },
      },
      {
        id: 'n1:languages:it',
        sentence: {
          kind: 'language',
          about: ['n1'],
          person: 'n1',
          language: 'it',
          level: 'native',
        },
      },
    ]);
    expect(edgeItems(draft, defaultChoices(draft)).map(({ sentence }) => sentence)).toEqual([
      { kind: 'couple', about: [me, 'n1'], couple: 'spouse', people: [me, 'n1'], start: '2010' },
      { kind: 'parent', about: ['n1', bruna], parent: 'n1', child: bruna },
    ]);
  });

  it('hides the edges of a dropped person, and starts a second writer dropped', () => {
    const base = defaultChoices(draft);
    const choices = { ...base, people: new Map(base.people).set('n1', dropped) };
    expect(edgeItems(draft, choices)).toEqual([]);
    const twice = draftOf({
      people: [
        { ref: me, role: 'self' },
        { ref: 'n1', role: 'self' },
      ],
      relationships: [],
    });
    expect(defaultChoices(twice).people.get('n1')?.keep).toBe(false);
  });

  it('needs a name for every new person it keeps', () => {
    expect(namesReady(draft, choose(draft, { n1: 'Davi' }))).toBe(false);
    const ready = choose(draft, { n1: ' Davi ', n2: 'Eva' });
    expect(namesReady(draft, ready)).toBe(true);
    expect(newPeople(draft, ready)).toEqual([
      { ref: 'n1', displayName: 'Davi', caseMember: true },
      { ref: 'n2', displayName: 'Eva', caseMember: false },
    ]);
    const one = choose(draft, { n1: 'Davi' });
    const people = new Map(one.people).set('n2', dropped);
    expect(namesReady(draft, { ...one, people })).toBe(true);
  });

  it('saves facts, lists confirmed whole next to the stored entries, and new edges', () => {
    const choices = choose(
      draft,
      { n1: 'Davi', n2: 'Eva' },
      { whole: new Set([listId(bruna, 'citizenships'), listId('n1', 'citizenships')]) },
    );
    const questions = questionsWith({
      [bruna]: { citizenships: [{ country: 'BR', basis: 'birth' }] },
    });
    const created = new Map([
      ['n1', 'davi'],
      ['n2', 'eva'],
    ]);
    expect(intakeWrites(draft, choices, view, questions, created)).toEqual({
      answers: [
        { personId: me, answers: [{ questionId: 'birthDate', answer: '1985' }] },
        {
          personId: bruna,
          answers: [
            {
              questionId: 'citizenships',
              answer: [{ country: 'BR', basis: 'birth' }, { country: 'IT' }],
            },
          ],
        },
        // The languages list was not confirmed whole, so it is left for the guided questions.
        {
          personId: 'davi',
          answers: [{ questionId: 'citizenships', answer: [{ country: 'IT' }] }],
        },
      ],
      relationships: [
        { kind: 'spouse', from: me, to: 'davi', details: { start: '2010' } },
        { kind: 'parent', from: 'davi', to: bruna, details: {} },
      ],
    });
  });

  it('leaves out dropped facts, dropped people and their edges', () => {
    const base = choose(draft, { n2: 'Eva' });
    const choices: IntakeChoices = {
      ...base,
      people: new Map(base.people).set('n1', dropped),
      dropped: new Set([`${bruna}:citizenships:IT`]),
      whole: new Set([listId(bruna, 'citizenships')]),
    };
    expect(intakeWrites(draft, choices, view, empty, new Map([['n2', 'eva']]))).toEqual({
      answers: [{ personId: me, answers: [{ questionId: 'birthDate', answer: '1985' }] }],
      relationships: [],
    });
  });

  it('adds the details the draft gives a stored relationship to its keeper’s answer', () => {
    const filled = draftOf({
      people: [{ ref: me }, { ref: bruna }],
      relationships: [{ kind: 'parent', parent: me, child: bruna, start: '2016' }],
    });
    const row = { id: edge, kind: 'parent', from: me, to: bruna, parentKind: 'biological' };
    const questions = questionsWith({ [me]: { relationships: [row] } });
    expect(intakeWrites(filled, choose(filled, {}), view, questions, new Map())).toEqual({
      answers: [
        {
          personId: me,
          answers: [{ questionId: 'relationships', answer: [{ ...row, start: '2016' }] }],
        },
      ],
      relationships: [],
    });
  });

  it('skips an edge with a dropped end, or one the viewer keeps neither end of', () => {
    const outside = draftOf({
      people: [{ ref: caio }, { ref: me }, { ref: 'n1' }],
      relationships: [
        { kind: 'parent', parent: me, child: 'n1' },
        { kind: 'partner', people: [caio, bruna] },
      ],
    });
    const base = choose(outside, {});
    const choices = { ...base, people: new Map(base.people).set('n1', dropped) };
    const outsideView = {
      ...view,
      people: [person(me, 'Alice'), person(bruna, 'Bruna', false), person(caio, 'Caio', false)],
    };
    expect(intakeWrites(outside, choices, outsideView, empty, new Map())).toEqual({
      answers: [],
      relationships: [],
    });
  });
});

describe('saving the intake (spec 0008, R4)', () => {
  const draft = draftOf({
    people: [{ ref: me }, { ref: 'n1', role: 'child', birthDate: '2015' }],
    relationships: [{ kind: 'parent', parent: me, child: 'n1' }],
  });
  const choices = choose(draft, { n1: 'Davi' });

  function calls(failAt = -1) {
    const made: string[] = [];
    let people = view.people;
    const step = (name: string) => {
      made.push(name);
      if (made.length - 1 === failAt) return Promise.reject(new Error('offline'));
      return Promise.resolve({ ...view, people });
    };
    const fake: IntakeCalls = {
      addPerson: ({ displayName }) => {
        people = [...people, person(`id-${displayName}`, displayName)];
        return step(`add ${displayName}`);
      },
      answer: ({ personId }) => step(`answer ${personId}`),
      relate: ({ from, to }) => step(`relate ${from} ${to}`),
    };
    return { fake, made };
  }

  it('creates people first, then answers, then relationships', async () => {
    const { fake, made } = calls();
    await saveIntake(draft, choices, view, empty, fake, freshProgress());
    expect(made).toEqual(['add Davi', 'answer id-Davi', `relate ${me} id-Davi`]);
  });

  it('resumes the writes it planned, even when the case read again has changed', async () => {
    const progress = freshProgress();
    const first = calls(2);
    await expect(saveIntake(draft, choices, view, empty, first.fake, progress)).rejects.toThrow();
    // Read again after the answer, the case shows the child's birth date as stored.
    const reread = { ...view, people: [...view.people, person('id-Davi', 'Davi')] };
    const second = calls();
    const stored = questionsWith({ 'id-Davi': { birthDate: '2015' } });
    await saveIntake(draft, choices, reread, stored, second.fake, progress);
    expect(second.made).toEqual([`relate ${me} id-Davi`]);
  });
});
