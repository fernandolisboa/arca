import { createHash } from 'node:crypto';
import { treeEntries } from './git.ts';
import { modelVariables } from './reviewers.ts';

/**
 * Everything that shapes how the reviewers behave: their definitions and instructions, the
 * reference docs, the gate's workflows, actions, scripts and canary corpus. A canary result counts
 * only for the fingerprint it ran on, together with the models the reviewers run on (ADR-0013).
 */
export const gatePaths = [
  '.claude/',
  '.github/actions/',
  '.github/workflows/review-canary.yml',
  '.github/workflows/review-gate.yml',
  'CLAUDE.md',
  'README.md',
  '.github/policy/gitleaks.toml',
  'docs/',
  'eval/review-gate/',
  'tooling/scripts/package.json',
  'tooling/scripts/src/report.ts',
  'tooling/scripts/src/review-gate/',
] as const;
/** Changes with every pull request that accepts a finding, and never reaches a model. */
const ignoredPaths = new Set(['docs/review-acceptances.md']);

const modelId = /^[a-z0-9][a-z0-9.-]{0,99}$/;

/**
 * The model each alias runs on: the ID pinned in its repository variable, or the alias itself
 * when the variable is unset, so the reviewers follow the newest model. A malformed pin fails.
 */
export function reviewModels(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(modelVariables).map(([alias, variable]) => {
      const pinned = environment[variable];
      if (pinned === undefined || pinned === '') return [alias, alias];
      if (!modelId.test(pinned))
        throw new Error(`the repository variable ${variable} is malformed`);
      return [alias, pinned];
    }),
  );
}

export function gateFingerprint(
  repo: string,
  revision: string,
  models: Readonly<Record<string, string>>,
): string {
  const tree = treeEntries(repo, revision, gatePaths)
    .filter((entry) => !ignoredPaths.has(entry.path))
    .map((entry) => `${entry.mode} ${entry.type} ${entry.object}\t${entry.path}`)
    .join('\n');
  const pinned = Object.keys(models)
    .sort()
    .map((alias) => `${alias}=${models[alias] ?? ''}`)
    .join('\n');
  return createHash('sha256').update(`${tree}\n--\n${pinned}\n`).digest('hex');
}
