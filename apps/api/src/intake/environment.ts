import type { ClaudeKey } from '../ai/claude.js';
import type { DeploymentEnvironment } from '../config.js';
import { claudeExtractor } from './claude-extractor.js';
import type { Extractor } from './extractor.js';
import { fakeExtractor } from './fake-extractor.js';

/**
 * The extractor a deployment has, or none without a key source, so the intake route answers
 * 503; a source that resolves to no key fails each call as unavailable.
 * Production has one since the evaluation suite passed (real-data gate item 10; spec 0008, ticket
 * 4). A development server asked for the scripted one, as the e2e build is, gets it and never
 * calls Claude.
 */
export function extractorFor(
  environment: DeploymentEnvironment,
  apiKey: ClaudeKey | undefined,
  scripted = false,
): Extractor | undefined {
  if (environment === 'development' && scripted) return fakeExtractor;
  return apiKey === undefined ? undefined : claudeExtractor({ apiKey });
}
