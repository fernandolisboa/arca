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

const choose = (
  draft: IntakeDraft,
  change: (choices: IntakeChoices) => Partial<IntakeChoices>,
): IntakeChoices => {
  const base = defaultChoices(draft, view);
  return { ...base, ...change(base) };
};

const named = (choices: IntakeChoices, names: Record<string, string>) =>
  new Map(
    [...choices.people].map(([ref, choice]) => [
      ref,
      choice.kind === 'new' ? { ...choice, displayName: names[ref] ?? '' } : choice,
    ]),
  );

describe('the intake save plan (spec 0008, R4)', () => {
  const draft = draftOf({
    people: [
      { ref: 'n1', role: 'self', birthDate: '1985' },
      { ref: bruna, role: 'child', citizenships: ['IT'] },
      {
        ref: 'n2',
        role: 'spouse',
        citizenships: ['IT'],
        languages: [{ language: 'it', level: 'native' }],
      },
      { ref: 'n3', role: 'sibling' },
    ],
    relationships: [
      { kind: 'spouse', people: ['n1', 'n2'], start: '2010' },
      { kind: 'parent', parent: 'n2', child: bruna },
    ],
  });

  it('starts with the writer as the viewer, known people as themselves, and members by role', () => {
    const { people } = defaultChoices(draft, view);
    expect(people.get('n1')).toEqual({ kind: 'match', personId: me });
    expect(people.get(bruna)).toEqual({ kind: 'match', personId: bruna });
    expect(people.get('n2')).toEqual({ kind: 'new', displayName: '', caseMember: true });
    expect(people.get('n3')).toEqual({ kind: 'new', displayName: '', caseMember: false });
  });

  it('keeps the writer new when the text names the viewer too', () => {
    const both = draftOf({ people: [{ ref: me }, { ref: 'n1', role: 'self' }], relationships: [] });
    expect(defaultChoices(both, view).people.get('n1')).toMatchObject({ kind: 'new' });
  });

  it('words each fact and edge as the sentence it adds', () => {
    expect(personItems(draft.people[2] ?? { ref: '' })).toEqual([
      {
        id: 'n2:citizenships:IT',
        sentence: { kind: 'citizenship', about: ['n2'], person: 'n2', country: 'IT' },
      },
      {
        id: 'n2:languages:it',
        sentence: {
          kind: 'language',
          about: ['n2'],
          person: 'n2',
          language: 'it',
          level: 'native',
        },
      },
    ]);
    expect(edgeItems(draft).map(({ sentence }) => sentence)).toEqual([
      {
        kind: 'couple',
        about: ['n1', 'n2'],
        couple: 'spouse',
        people: ['n1', 'n2'],
        start: '2010',
      },
      { kind: 'parent', about: ['n2', bruna], parent: 'n2', child: bruna },
    ]);
  });

  it('needs a name for every new person', () => {
    const choices = defaultChoices(draft, view);
    expect(namesReady(draft, choices)).toBe(false);
    const ready = { ...choices, people: named(choices, { n2: ' Davi ', n3: 'Eva' }) };
    expect(namesReady(draft, ready)).toBe(true);
    expect(newPeople(draft, ready)).toEqual([
      { ref: 'n2', displayName: 'Davi', caseMember: true },
      { ref: 'n3', displayName: 'Eva', caseMember: false },
    ]);
  });

  it('saves facts, lists confirmed whole next to the stored entries, and new edges', () => {
    const choices = choose(draft, (base) => ({
      people: named(base, { n2: 'Davi', n3: 'Eva' }),
      whole: new Set([listId(bruna, 'citizenships'), listId('n2', 'citizenships')]),
    }));
    const questions = questionsWith({
      [bruna]: { citizenships: [{ country: 'BR', basis: 'birth' }] },
    });
    const created = new Map([
      ['n2', 'davi'],
      ['n3', 'eva'],
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
    const choices = choose(draft, (base) => ({
      people: new Map(base.people).set('n2', { kind: 'drop' }),
      dropped: new Set([`${bruna}:citizenships:IT`]),
      whole: new Set([listId(bruna, 'citizenships')]),
    }));
    expect(intakeWrites(draft, choices, view, empty, new Map())).toEqual({
      answers: [{ personId: me, answers: [{ questionId: 'birthDate', answer: '1985' }] }],
      relationships: [],
    });
  });

  it('fills only what a matched person lacks, and a stored edge only with details it lacks', () => {
    const matched = draftOf({
      people: [
        {
          ref: 'n1',
          birthDate: '2015',
          residenceCountry: 'PT',
          languages: [
            { language: 'pt', level: 'C1' },
            { language: 'en', level: 'B2' },
          ],
        },
        { ref: 'n2', role: 'self' },
      ],
      relationships: [
        { kind: 'parent', parent: 'n2', child: 'n1', parentKind: 'adoptive', start: '2016' },
      ],
    });
    const choices = choose(matched, (base) => ({
      people: new Map(base.people).set('n1', { kind: 'match', personId: bruna }),
      whole: new Set([listId('n1', 'languages')]),
    }));
    const row = { id: edge, kind: 'parent', from: me, to: bruna, parentKind: 'biological' };
    const questions = questionsWith({
      [me]: { relationships: [row] },
      [bruna]: { birthDate: '2015-03-12', languages: [{ language: 'pt', level: 'native' }] },
    });
    expect(intakeWrites(matched, choices, view, questions, new Map())).toEqual({
      answers: [
        {
          personId: bruna,
          answers: [
            { questionId: 'residenceCountry', answer: 'PT' },
            {
              questionId: 'languages',
              answer: [
                { language: 'pt', level: 'native' },
                { language: 'en', level: 'B2' },
              ],
            },
          ],
        },
        {
          personId: me,
          answers: [{ questionId: 'relationships', answer: [{ ...row, start: '2016' }] }],
        },
      ],
      relationships: [],
    });
  });

  it('replaces the level of a language the draft restates for the same person', () => {
    const restated = draftOf({
      people: [{ ref: bruna, languages: [{ language: 'pt', level: 'C2' }] }],
      relationships: [],
    });
    const choices = choose(restated, () => ({ whole: new Set([listId(bruna, 'languages')]) }));
    const questions = questionsWith({ [bruna]: { languages: [{ language: 'pt', level: 'B1' }] } });
    expect(intakeWrites(restated, choices, view, questions, new Map()).answers).toEqual([
      {
        personId: bruna,
        answers: [{ questionId: 'languages', answer: [{ language: 'pt', level: 'C2' }] }],
      },
    ]);
  });

  it('skips an edge to oneself or between people the viewer does not keep, and merges twins', () => {
    const odd = draftOf({
      people: [{ ref: me }, { ref: 'n1' }, { ref: 'n2' }, { ref: caio }, { ref: 'n3' }],
      relationships: [
        { kind: 'partner', people: ['n1', 'n2'] },
        { kind: 'parent', parent: caio, child: 'n3' },
        { kind: 'partner', people: [me, 'n3'] },
        { kind: 'partner', people: ['n3', me], start: '2020' },
      ],
    });
    const choices = choose(odd, (base) => ({
      people: new Map(base.people)
        .set('n1', { kind: 'match', personId: me })
        .set('n2', { kind: 'match', personId: me })
        .set('n3', { kind: 'match', personId: caio }),
    }));
    expect(intakeWrites(odd, choices, view, empty, new Map()).relationships).toEqual([
      { kind: 'partner', from: me, to: caio, details: { start: '2020' } },
    ]);
  });
});

describe('saving the intake (spec 0008, R4)', () => {
  const draft = draftOf({
    people: [{ ref: me }, { ref: 'n1', role: 'child', birthDate: '2015' }],
    relationships: [{ kind: 'parent', parent: me, child: 'n1' }],
  });
  const choices = choose(draft, (base) => ({ people: named(base, { n1: 'Davi' }) }));

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

  it('resumes a failed save without creating anyone twice', async () => {
    const progress = freshProgress();
    const first = calls(1);
    await expect(saveIntake(draft, choices, view, empty, first.fake, progress)).rejects.toThrow();
    const second = calls();
    await saveIntake(draft, choices, view, empty, second.fake, progress);
    expect(second.made).toEqual(['answer id-Davi', `relate ${me} id-Davi`]);
  });
});
