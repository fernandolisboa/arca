import { createHash } from 'node:crypto';
import { gitText } from './git.ts';

/**
 * Everything that shapes how the reviewers behave: their definitions and instructions, the
 * reference docs, the gate's workflows, actions, scripts and canary corpus. A canary result counts
 * only for the fingerprint it ran on, together with the model IDs (ADR-0013).
 */
export const gatePaths = [
  '.claude/',
  '.github/actions/',
  '.github/workflows/review-canary.yml',
  '.github/workflows/review-gate.yml',
  'CLAUDE.md',
  'README.md',
  'docs/',
  'eval/review-gate/',
  'tooling/scripts/src/review-gate/',
] as const;
/** Changes with every pull request that accepts a finding, and never reaches a model. */
const ignoredPaths = new Set(['docs/review-acceptances.md']);

/** Model aliases the agents use and the variable that pins each to a model ID. */
export const modelVariables = {
  fable: 'REVIEW_MODEL_FABLE',
  opus: 'REVIEW_MODEL_OPUS',
  haiku: 'REVIEW_MODEL_HAIKU',
} as const;
const modelId = /^[a-z0-9][a-z0-9.-]{0,99}$/;

/** Resolves each alias to its pinned model ID from the environment; a missing or odd one fails. */
export function pinnedModels(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(modelVariables).map(([alias, variable]) => {
      const id = environment[variable];
      if (id === undefined || !modelId.test(id)) {
        throw new Error(`the repository variable ${variable} is missing or malformed`);
      }
      return [alias, id];
    }),
  );
}

export function gateFingerprint(
  repo: string,
  revision: string,
  models: Readonly<Record<string, string>>,
): string {
  const tree = gitText(repo, ['ls-tree', '-r', '--full-tree', revision, '--', ...gatePaths])
    .split('\n')
    .filter((line) => line !== '' && !ignoredPaths.has(line.slice(line.indexOf('\t') + 1)))
    .join('\n');
  const pinned = Object.keys(models)
    .sort()
    .map((alias) => `${alias}=${models[alias] ?? ''}`)
    .join('\n');
  return createHash('sha256').update(`${tree}\n--\n${pinned}\n`).digest('hex');
}
