import { start, type StartOptions } from 'workflow/api';
import type { WorkflowArgument } from './workflow-arguments.js';

/** Options for a run of this deployment, which is the only kind Arca starts. */
type RunOptions = Extract<StartOptions, { deploymentId?: undefined }>;

/** Every run starts in São Paulo, and its payloads are purged when it ends (ADR-0009). */
export const runOptions = {
  region: 'gru1',
  experimental_retention: 0,
} as const satisfies RunOptions;

export type StartRun = <Args extends unknown[]>(
  workflow: (...args: Args) => Promise<unknown>,
  args: Args,
  options: RunOptions,
) => Promise<{ readonly runId: string }>;

/**
 * The only caller of the SDK's `start()` (spec 0001, R6). Its type admits identifier-shaped
 * arguments only, so no personal data reaches a run's stored input.
 */
export async function startWorkflow<Args extends WorkflowArgument[]>(
  workflow: (...args: Args) => Promise<unknown>,
  args: Args,
  startRun: StartRun = start,
): Promise<string> {
  const run = await startRun(workflow, args, runOptions);
  return run.runId;
}
