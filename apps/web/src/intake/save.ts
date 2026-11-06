import type {
  AnswerCaseQuestionsRequest,
  CaseQuestions,
  CaseView,
} from '@arca/api-contract/client';
import {
  type IntakeChoices,
  type IntakeDraft,
  type NewRelationship,
  intakeWrites,
  newPeople,
} from './plan.js';

/** The case writes a save makes; each answers the case as the viewer now sees it. */
export interface IntakeCalls {
  readonly addPerson: (body: {
    displayName: string;
    caseMember: boolean;
  }) => Promise<CaseView | null>;
  readonly answer: (body: AnswerCaseQuestionsRequest) => Promise<CaseView | null>;
  readonly relate: (body: NewRelationship) => Promise<CaseView | null>;
}

/**
 * How far a save got, kept across retries so a failed save resumes where it stopped instead of
 * creating the same people twice. The screen locks the choices once a save starts.
 */
export interface IntakeProgress {
  readonly created: Map<string, string>;
  done: number;
}

export const freshProgress = (): IntakeProgress => ({ created: new Map(), done: 0 });

/**
 * Saves the kept draft through the existing case routes (spec 0008, R4): new people first, then
 * each person's answers, then the new relationships. Answers the case as last written.
 */
export async function saveIntake(
  draft: IntakeDraft,
  choices: IntakeChoices,
  view: CaseView,
  questions: CaseQuestions,
  calls: IntakeCalls,
  progress: IntakeProgress,
): Promise<CaseView | null> {
  let current: CaseView | null = view;
  for (const { ref, displayName, caseMember } of newPeople(draft, choices)) {
    if (progress.created.has(ref)) continue;
    const before = new Set([
      ...(current?.people.map(({ id }) => id) ?? []),
      ...progress.created.values(),
    ]);
    current = await calls.addPerson({ displayName, caseMember });
    const added = current?.people.find(({ id }) => !before.has(id));
    if (added === undefined) throw new Error('The new person is missing from the case');
    progress.created.set(ref, added.id);
  }
  const { answers, relationships } = intakeWrites(
    draft,
    choices,
    view,
    questions,
    progress.created,
  );
  const writes = [
    ...answers.map((body) => () => calls.answer(body)),
    ...relationships.map((body) => () => calls.relate(body)),
  ];
  for (const write of writes.slice(progress.done)) {
    current = await write();
    progress.done += 1;
  }
  return current;
}
