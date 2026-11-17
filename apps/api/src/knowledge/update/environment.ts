import type { AiProvider } from '@arca/api-contract/routes';
import { scriptedCheckerModel } from '@arca/domain';
import type { AiSettingsReader } from '../../ai/settings.js';
import type { DeploymentEnvironment } from '../../config.js';
import { claudeRuleResearcher } from './claude-researcher.js';
import { jevRuleValidator } from './jev-validator.js';
import type { RuleResearcher, RuleValidator, StageModel } from './ports.js';
import { scriptedRuleResearcher, scriptedRuleValidator } from './scripted.js';

/** The models an update request calls, as a deployment picks them (ADR-0031). */
export interface UpdateModels {
  readonly researcher: RuleResearcher;
  readonly validator: RuleValidator;
  readonly model: (stage: 'research' | 'validation' | 'correction') => Promise<StageModel>;
  /** Whether every provider a request calls has a key it can use. */
  readonly configured: () => Promise<boolean>;
}

const scriptedModels: UpdateModels = {
  researcher: scriptedRuleResearcher,
  validator: scriptedRuleValidator,
  model: () => Promise.resolve({ model: scriptedCheckerModel, effort: null }),
  configured: () => Promise.resolve(true),
};

/**
 * Production calls Claude for research and correction and TypeSafe's Jev for validation, with the
 * keys, models and efforts settings hold, read on every call; everywhere else the scripted models
 * run, which call nothing, so no validator answer is ever stored under a real model's name.
 */
export function updateModelsFor(
  environment: DeploymentEnvironment,
  settings: AiSettingsReader,
): UpdateModels {
  if (environment !== 'production') return scriptedModels;
  const keyOf = (provider: AiProvider) => async () => {
    const resolved = await settings.key(provider);
    return resolved.state === 'set' || resolved.state === 'environment' ? resolved.key : undefined;
  };
  const anthropic = keyOf('anthropic');
  const typesafe = keyOf('typesafe');
  return {
    researcher: claudeRuleResearcher({ apiKey: anthropic }),
    validator: jevRuleValidator({ apiKey: typesafe }),
    model: async (stage) => {
      const { model, effort } = await settings.stage(stage);
      return { model, effort };
    },
    configured: async () => (await anthropic()) !== undefined && (await typesafe()) !== undefined,
  };
}
