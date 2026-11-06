import type { DeploymentEnvironment } from '../config.js';
import { claudeExtractor } from './claude-extractor.js';
import type { Extractor } from './extractor.js';
import { fakeExtractor } from './fake-extractor.js';

/**
 * The extractor a deployment has, or none, so the intake route answers 503. Production gets none
 * until the evaluation suite passes (real-data gate item 10; spec 0008, ticket 4). A development
 * server asked for the scripted one, as the e2e build is, gets it and never calls Claude.
 */
export function extractorFor(
  environment: DeploymentEnvironment,
  apiKey: string | undefined,
  scripted = false,
): Extractor | undefined {
  if (environment === 'production') return undefined;
  if (environment === 'development' && scripted) return fakeExtractor;
  return apiKey === undefined ? undefined : claudeExtractor({ apiKey });
}
