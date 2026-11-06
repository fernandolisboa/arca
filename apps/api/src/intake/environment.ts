import type { DeploymentEnvironment } from '../config.js';
import { claudeExtractor } from './claude-extractor.js';
import type { Extractor } from './extractor.js';
import { fakeExtractor } from './fake-extractor.js';

/**
 * The extractor a deployment has, or none, so the intake route answers 503. Production gets none
 * until the evaluation suite passes (real-data gate item 10; spec 0008, ticket 4); development
 * without a key, which the e2e build runs as, gets the scripted one.
 */
export function extractorFor(
  environment: DeploymentEnvironment,
  apiKey: string | undefined,
): Extractor | undefined {
  if (environment === 'production') return undefined;
  if (apiKey !== undefined) return claudeExtractor({ apiKey });
  return environment === 'development' ? fakeExtractor : undefined;
}
