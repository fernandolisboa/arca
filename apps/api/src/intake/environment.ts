import type { DeploymentEnvironment } from '../config.js';
import { claudeExtractor } from './claude-extractor.js';
import type { Extractor } from './extractor.js';

/**
 * The extractor a deployment has, or none, so the intake route answers 503. Production gets none
 * until the evaluation suite passes (real-data gate item 10; spec 0008, ticket 4).
 */
export function extractorFor(
  environment: DeploymentEnvironment,
  apiKey: string | undefined,
): Extractor | undefined {
  return environment === 'production' || apiKey === undefined
    ? undefined
    : claudeExtractor({ apiKey });
}
