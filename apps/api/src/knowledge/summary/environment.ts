import type { DeploymentEnvironment } from '../../config.js';
import { claudeSummarizer } from './claude-summarizer.js';
import { fakeSummarizer } from './fake-summarizer.js';
import { ruleSummaryModel } from './model.js';
import type { Summarizer } from './summarizer.js';

/** A summarizer and the model its summaries are stored under. */
export interface SummarizerChoice {
  readonly summarizer: Summarizer;
  readonly model: string;
}

/**
 * The summarizer a deployment has, or none without a key, so the summary route answers 503. A
 * development server asked for the scripted one, as the e2e build is, gets it and never calls
 * Claude.
 */
export function summarizerFor(
  environment: DeploymentEnvironment,
  apiKey: string | undefined,
  scripted = false,
): SummarizerChoice | undefined {
  // A scripted summary is stored apart from the model's, so neither is ever read as the other.
  if (environment === 'development' && scripted)
    return { summarizer: fakeSummarizer, model: 'fake' };
  return apiKey === undefined
    ? undefined
    : { summarizer: claudeSummarizer({ apiKey }), model: ruleSummaryModel };
}
