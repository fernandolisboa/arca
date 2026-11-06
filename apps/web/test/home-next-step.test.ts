import type { CaseQuestions, CaseView } from '@arca/api-contract/client';
import { describe, expect, it } from 'vitest';
import { dayPart, nextStep } from '../src/home/next-step.js';

/** Synthetic IDs only. */
const me = '00000000-0000-4000-8000-000000000001';
const child = '00000000-0000-4000-8000-000000000002';

const view: CaseView = {
  caseId: '00000000-0000-4000-8000-0000000000c1',
  me,
  people: [],
  relationships: [],
  assets: [],
};

type Question = CaseQuestions['people'][number]['steps'][number]['questions'][number];

function questionsWith(...people: (readonly Question[])[]): CaseQuestions {
  return {
    people: people.map((questions, index) => ({
      personId: index === 0 ? me : child,
      steps: [{ id: 'basics', questions: [...questions] }],
    })),
    countries: [],
    formerCountries: [],
  };
}

const open: Question = { id: 'birthDate' };
const answered: Question = { id: 'citizenships', answer: ['BR'] };
const unknown: Question = { id: 'residenceCountry', answer: null };

describe('nextStep', () => {
  it.each([
    ['no case yet', null, undefined, { stage: 'family', answered: 0, total: 0 }],
    ['questions still loading', view, undefined, { stage: 'questions', answered: 0, total: 0 }],
    [
      'some questions open across people',
      view,
      questionsWith([answered, open], [unknown, open]),
      { stage: 'questions', answered: 2, total: 4 },
    ],
    [
      'every question answered, "Não sei" included',
      view,
      questionsWith([answered], [unknown]),
      { stage: 'routes', answered: 2, total: 2 },
    ],
  ] as const)('%s', (_name, caseView, questions, expected) => {
    expect(nextStep(caseView, questions)).toEqual(expected);
  });
});

describe('dayPart', () => {
  it.each([
    [0, 'evening'],
    [4, 'evening'],
    [5, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [23, 'evening'],
  ] as const)('%i h is %s', (hour, part) => {
    expect(dayPart(hour)).toBe(part);
  });
});
