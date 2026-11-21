import type { ClaudeKey } from '../../ai/claude.js';
import type { DeploymentEnvironment } from '../../config.js';
import { claudeSuggester } from './claude-suggester.js';
import { fakeSuggester } from './fake-suggester.js';
import type { CriterionSuggester } from './suggester.js';

/**
 * The suggester a deployment has, or none without a key source, so the route answers 503; a
 * source that resolves to no key fails each call as unavailable. A development server asked for
 * the scripted one, as the e2e build is, gets it and never calls Claude.
 */
export function suggesterFor(
  environment: DeploymentEnvironment,
  apiKey: ClaudeKey | undefined,
  scripted = false,
): CriterionSuggester | undefined {
  if (environment === 'development' && scripted) return fakeSuggester;
  return apiKey === undefined ? undefined : claudeSuggester({ apiKey });
}
