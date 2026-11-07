import type { CaseQuestions, CaseView } from '@arca/api-contract/client';

/** The case's stages as the home screen lists them, in order. */
export const stages = ['family', 'questions', 'routes'] as const;
export type Stage = (typeof stages)[number];

export interface NextStep {
  /** The stage the family is on; the ones before it are done. */
  readonly stage: Stage;
  /** Guided questions answered so far, "Não sei" included, over all the questions shown. */
  readonly answered: number;
  readonly total: number;
}

/**
 * Where the family stands, from the case and its guided questions: no case yet, questions still
 * open, or every question answered so the routes can be read. Questions not loaded yet, or none
 * shown at all, count as open, so the home never sends someone to the results too early.
 */
export function nextStep(view: CaseView | null, questions: CaseQuestions | undefined): NextStep {
  if (view === null) return { stage: 'family', answered: 0, total: 0 };
  const all = (questions?.people ?? []).flatMap((person) =>
    person.steps.flatMap((step) => step.questions),
  );
  const answered = all.filter((question) => question.answer !== undefined).length;
  const done = all.length > 0 && answered === all.length;
  return { stage: done ? 'routes' : 'questions', answered, total: all.length };
}

/** The part of the day for the greeting, from the device's local hour. */
export function dayPart(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}
