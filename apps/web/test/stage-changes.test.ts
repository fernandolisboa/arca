import { routes, type AiStageState } from '@arca/api-contract/client';
import { describe, expect, it } from 'vitest';
import { stageChanges } from '../src/settings/stage-changes.js';

const research: AiStageState = {
  stage: 'research',
  model: 'claude-opus-5-5',
  effort: 'high',
  isDefault: true,
};
const stored: AiStageState[] = [
  research,
  { stage: 'validation', model: 'jev-1.14.0', effort: null, isDefault: true },
];

describe('the stage changes a save sends', () => {
  it('sends nothing while every choice matches what is stored', () => {
    expect(stageChanges(stored, {})).toEqual([]);
    expect(
      stageChanges(stored, { research: { model: 'claude-opus-5-5', effort: 'high' } }),
    ).toEqual([]);
  });

  it('sends only the changed stage, as a body the strict contract accepts', () => {
    // A choice edited from the stored state carries its other fields along.
    const edited = { ...research, effort: 'max' as const };
    const changes = stageChanges(stored, { research: edited });
    expect(changes).toEqual([{ stage: 'research', model: 'claude-opus-5-5', effort: 'max' }]);
    expect(changes.map((change) => routes.setAiStage.body.parse(change))).toEqual(changes);
  });
});
