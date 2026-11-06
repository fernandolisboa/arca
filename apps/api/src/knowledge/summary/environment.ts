import type { DeploymentEnvironment } from '../../config.js';
import { claudeSummarizer } from './claude-summarizer.js';
import { fakeSummarizer } from './fake-summarizer.js';
import type { Summarizer } from './summarizer.js';

/**
 * The summarizer a deployment has, or none without a key, so the summary route answers 503. A
 * development server asked for the scripted one, as the e2e build is, gets it and never calls
 * Claude.
 */
export function summarizerFor(
  environment: DeploymentEnvironment,
  apiKey: string | undefined,
  scripted = false,
): Summarizer | undefined {
  if (environment === 'development' && scripted) return fakeSummarizer;
  return apiKey === undefined ? undefined : claudeSummarizer({ apiKey });
}
