import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** The reviewers in `.claude/agents/`, in the order docs/REVIEW.md lists them. */
export const allReviewers = [
  'correctness',
  'security',
  'architecture',
  'spec',
  'standards',
  'context',
  'auth-crypto',
  'data-access',
  'supply-chain',
  'ai-safety',
] as const;

export type Reviewer = (typeof allReviewers)[number];

export interface Selection {
  readonly reviewer: Reviewer;
  /** The changed paths that brought this reviewer in. */
  readonly paths: readonly string[];
}

interface Rule {
  readonly match: RegExp;
  readonly reviewers: readonly Reviewer[];
}

export const docsReviewers: readonly Reviewer[] = ['spec', 'standards', 'context'];
export const coreReviewers: readonly Reviewer[] = [
  'correctness',
  'security',
  'architecture',
  ...docsReviewers,
];

/** A path under the code roots whose directory or file name contains one of the keywords. */
function codeNamed(keywords: readonly string[]): RegExp {
  return new RegExp(`^(apps|packages|tooling|\\.github)/.*(${keywords.join('|')})`, 'i');
}

function anyOf(...patterns: readonly RegExp[]): RegExp {
  return new RegExp(patterns.map((pattern) => `(${pattern.source})`).join('|'), 'i');
}

// A path takes the reviewers of every rule it matches; a path no rule matches takes them all,
// so a new kind of file is over-reviewed rather than slipping through. The specialist rules match
// by area keywords as well as by directory, so a new file in a sensitive area is caught by its
// name; matching too much costs one extra reviewer, matching too little loses a security read.
const rules: readonly Rule[] = [
  // Markdown under the code roots may be a prompt or a fixture, so it is not docs.
  { match: /^(?!(apps|packages|tooling|eval)\/).*\.md$/, reviewers: docsReviewers },
  {
    match: /^(SECURITY\.md|docs\/(SECURITY|SETUP|RETENTION)\.md|docs\/(threat-models|runbooks)\/)/,
    reviewers: ['security'],
  },
  // ADRs and the data-flow register admit vendors and services.
  {
    match: /^docs\/(adr\/|ARCHITECTURE\.md)/,
    reviewers: ['security', 'architecture', 'supply-chain'],
  },
  {
    match:
      /^(apps|packages|tooling)\/.*\.(ts|tsx|js|mjs|cjs|css|html|json|sql|svg|png|webmanifest)$/,
    reviewers: coreReviewers,
  },
  {
    match: anyOf(
      /^apps\/api\//,
      /^apps\/[^/]+\/e2e\/postgres\//,
      /^packages\/(db|api-contract|telemetry)\//,
      /^tooling\/scripts\/src\/db\//,
      /^apps\/[^/]+\/(src|test|e2e)\/(.*\/)?knowledge/,
      codeNamed([
        'decision',
        'approver',
        'monitoring',
        'telemetry',
        'notification',
        'storage',
        'blob',
        'document',
        'export',
        'erasure',
        'deletion',
        'retention',
        'audit',
        'shar',
        'invite',
      ]),
    ),
    reviewers: [...coreReviewers, 'data-access'],
  },
  {
    match: anyOf(
      /^packages\/vault\//,
      /^apps\/[^/]+\/(src|test|e2e)\/(.*\/)?knowledge/,
      codeNamed([
        'auth',
        'passkey',
        'webauthn',
        'vault',
        'step-up',
        'sign-in',
        'recover',
        'enroll',
        'key-storage',
        'envelope',
        'crypto',
        'session',
        'device',
        'cookie',
        'shar',
        'invite',
        'approver',
        'decision',
      ]),
    ),
    reviewers: [...coreReviewers, 'auth-crypto'],
  },
  {
    match: anyOf(
      /^eval\//,
      codeNamed(['intake', 'prompt', 'extract', 'claude', 'anthropic', 'llm', '[/.-]eval[/.-]']),
    ),
    reviewers: [...coreReviewers, 'ai-safety'],
  },
  {
    match: anyOf(
      /(^|\/)(package\.json|vercel\.json|tsconfig[^/]*\.json|[^/]+\.config\.(ts|js|mjs|cjs))$/,
      /^(pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|\.npmrc)$/,
      /^(\.github|tooling)\//,
      /^packages\/[^/]+\/vendor\//,
      codeNamed(['email', 'monitoring', 'sentry', 'resend', 'push', 'blob', 'tunnel', 'webhook']),
    ),
    reviewers: [...coreReviewers, 'supply-chain'],
  },
  {
    match: /^(CLAUDE\.md|\.claude\/|docs\/agents\/|docs\/REVIEW\.md)/,
    reviewers: [...coreReviewers, 'supply-chain'],
  },
];

function reviewersFor(path: string): readonly Reviewer[] {
  const matched = rules.filter((rule) => rule.match.test(path));
  return matched.length === 0 ? allReviewers : matched.flatMap((rule) => rule.reviewers);
}

/** The reviewers a change needs, from the paths it changes, each with the paths that need it. */
export function selectReviewers(paths: readonly string[]): Selection[] {
  if (paths.length === 0) throw new Error('no changed files to select reviewers for');
  const needed = new Map<Reviewer, string[]>();
  for (const path of paths) {
    for (const reviewer of new Set(reviewersFor(path))) {
      needed.set(reviewer, [...(needed.get(reviewer) ?? []), path]);
    }
  }
  return allReviewers
    .filter((reviewer) => needed.has(reviewer))
    .map((reviewer) => ({ reviewer, paths: needed.get(reviewer) ?? [] }));
}

const run = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string[]> {
  const { stdout } = await run('git', [...args], { cwd });
  return stdout.split('\0').filter((path) => path !== '');
}

/**
 * The paths changed since the merge base with `base`, committed or not, plus untracked files.
 * Renames are split into a delete and an add, so a sensitive file moved under docs still brings
 * in the reviewers of the path it left.
 */
export async function changedPaths(base: string, cwd = process.cwd()): Promise<string[]> {
  if (base.startsWith('-')) throw new Error(`not a git revision: ${base}`);
  const [changed, untracked] = await Promise.all([
    git(cwd, ['diff', '--name-only', '-z', '--no-renames', '--merge-base', base]),
    git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  return [...new Set([...changed, ...untracked])];
}

async function main(): Promise<void> {
  const paths = await changedPaths(process.argv[2] ?? 'origin/main');
  for (const { reviewer, paths: because } of selectReviewers(paths)) {
    const shown = because.slice(0, 3).join(', ');
    const more = because.length > 3 ? ` and ${String(because.length - 3)} more` : '';
    console.log(`${reviewer}-reviewer: ${shown}${more}`);
  }
}

if (import.meta.main) await main();
