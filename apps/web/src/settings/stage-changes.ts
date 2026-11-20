import type { AiStage, AiStageState } from '@arca/api-contract/client';

export type StageChoice = Pick<AiStageState, 'model' | 'effort'>;

/** The requests that save the chosen stages: one per stage whose choice differs from the stored. */
export function stageChanges(
  stored: readonly AiStageState[],
  choices: Partial<Record<AiStage, StageChoice>>,
): ({ readonly stage: AiStage } & StageChoice)[] {
  return stored.flatMap(({ stage, model, effort }) => {
    const choice = choices[stage];
    return choice === undefined || (choice.model === model && choice.effort === effort)
      ? []
      : [{ stage, model: choice.model, effort: choice.effort }];
  });
}
