import type {
  AnswerCaseQuestionsRequest,
  CaseQuestions,
  CaseView,
} from '@arca/api-contract/client';
import {
  type IntakeChoices,
  type IntakeDraft,
  type IntakeWrites,
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
 * How far a save got, kept across retries so a failed save resumes where it stopped: the people
 * it created, and the writes it planned once they existed, so a case read again in between cannot
 * shift what is left to send. The screen locks the choices once a save starts.
 */
export interface IntakeProgress {
  readonly created: Map<string, string>;
  writes?: IntakeWrites;
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
  progress.writes ??= intakeWrites(draft, choices, view, questions, progress.created);
  const writes = [
    ...progress.writes.answers.map((body) => () => calls.answer(body)),
    ...progress.writes.relationships.map((body) => () => calls.relate(body)),
  ];
  for (const write of writes.slice(progress.done)) {
    current = await write();
    progress.done += 1;
  }
  return current;
}
