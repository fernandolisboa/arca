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
  // `step-up` also matches `step_up`, as migrations spell it.
  const spelled = keywords.map((keyword) => keyword.replace(/(?<=\w)-(?=\w)/g, '[-_]'));
  return new RegExp(`^(apps|packages|tooling|\\.github)/.*(${spelled.join('|')})`, 'i');
}

function anyOf(...patterns: readonly RegExp[]): RegExp {
  return new RegExp(patterns.map((pattern) => `(${pattern.source})`).join('|'), 'i');
}

function withCore(...specialists: readonly Reviewer[]): readonly Reviewer[] {
  return [...coreReviewers, ...specialists];
}

const knowledgeBaseScreens = /^apps\/[^/]+\/(src|test|e2e)\/(.*\/)?knowledge/;
const databaseTests =
  /^(apps\/[^/]+\/(test|e2e)\/postgres\/|packages\/db\/test\/|tooling\/scripts\/test\/(postgres\/|db-))/;
// Who may see or decide what: both the access rules and the step-ups behind them.
const accessKeywords = ['shar', 'invite', 'admin', 'owner-list', 'decision'];

// A path takes the reviewers of every rule it matches; a path no rule matches takes them all,
// so a new kind of file is over-reviewed rather than slipping through. Sensitive packages carry
// their specialists on every file; elsewhere specialists match area keywords in file and directory
// names. Matching too much costs one extra reviewer; matching too little loses a security read.
const rules: readonly Rule[] = [
  // Markdown under the code roots may be a prompt or a fixture, so it is not docs.
  { match: /^(?!(apps|packages|tooling|eval)\/).*\.md$/, reviewers: docsReviewers },
  // Route notes are what the scheduled rule audit reads back the next month.
  {
    match:
      /^(SECURITY\.md|docs\/(SECURITY|SETUP|RETENTION)\.md|docs\/(threat-models|runbooks|research\/routes)\/)/,
    reviewers: ['security'],
  },
  // The scheduled rule audit reads its hosts by these recipes with nobody watching.
  { match: /^docs\/runbooks\/reading-recipes\.md$/, reviewers: ['supply-chain'] },
  { match: /^docs\/vault-format\.md$/, reviewers: ['security', 'auth-crypto'] },
  // ADRs and the data-flow register admit vendors and services and set the auth and vault design.
  {
    match: /^docs\/(adr\/|ARCHITECTURE\.md)/,
    reviewers: ['security', 'architecture', 'supply-chain', 'auth-crypto'],
  },
  {
    match:
      /^(apps|packages|tooling)\/.*\.(ts|tsx|js|mjs|cjs|css|html|json|sql|svg|png|webmanifest)$/,
    reviewers: coreReviewers,
  },
  // The API holds sessions, CSRF and headers, secrets and every third-party call.
  { match: /^apps\/api\//, reviewers: withCore('data-access', 'auth-crypto', 'supply-chain') },
  { match: /^packages\/(vault|platform)\//, reviewers: withCore('auth-crypto') },
  // The schema, the contract, the client's data and session glue, database-backed tests, version
  // selection (ADR-0014) and the content hash a knowledge-base decision is bound to.
  {
    match: anyOf(
      databaseTests,
      /^packages\/(db|api-contract)\//,
      /^apps\/web\/src\/[^/]+\.tsx?$/,
      /^apps\/web\/e2e\//,
      /^packages\/domain\/(src|test)\/rules\/(catalog|version-|decisions)/,
      /^packages\/knowledge\/(src|test)\/(catalog|reproduction|display)/,
      /^packages\/knowledge\/(scripts\/(content-hash|canonical|hashes)\.ts|data\/hashes\.json)$/,
      /^tooling\/scripts\/src\/db\/guards\.ts$/,
    ),
    reviewers: withCore('data-access', 'auth-crypto'),
  },
  { match: /^apps\/web\/(src\/main\.tsx|index\.html)$/, reviewers: withCore('supply-chain') },
  {
    match: anyOf(
      /^packages\/telemetry\//,
      /^tooling\/scripts\/src\/db\//,
      knowledgeBaseScreens,
      codeNamed([
        ...accessKeywords,
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
      ]),
    ),
    reviewers: withCore('data-access'),
  },
  {
    match: anyOf(
      knowledgeBaseScreens,
      codeNamed([
        ...accessKeywords,
        'auth',
        'passkey',
        'webauthn',
        'prf',
        'fido',
        'vault',
        'step-up',
        'sign-in',
        'recover',
        'enroll',
        'token',
        'key-storage',
        'envelope',
        'framing',
        'crypto',
        'session',
        'device',
        'cookie',
      ]),
    ),
    reviewers: withCore('auth-crypto'),
  },
  {
    match: anyOf(
      /^eval\//,
      codeNamed([
        'intake',
        'prompt',
        'extract',
        'claude',
        'anthropic',
        '[/.-]llm[/.-]',
        '[/.-]eval[/.-]',
      ]),
    ),
    reviewers: withCore('ai-safety'),
  },
  {
    match: anyOf(
      /(^|\/)(package\.json|vercel\.json|tsconfig[^/]*\.json|[^/]+\.config\.(ts|js|mjs|cjs))$/,
      /^(pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|\.npmrc)$/,
      /^(\.github|tooling)\//,
      /^packages\/[^/]+\/vendor\//,
      codeNamed([
        'email',
        'monitoring',
        'sentry',
        'resend',
        'push',
        'vapid',
        'blob',
        'tunnel',
        'webhook',
        'config',
        'secret',
        'csp',
        'trusted-types',
        'service-worker',
        'pwa',
      ]),
    ),
    reviewers: withCore('supply-chain'),
  },
  // Agent and review configuration, wherever an agent would load it (threat model S4). The rule
  // audit runbook holds the scheduled run's prompt and what that run may merge on its own.
  {
    match:
      /(^|\/)((CLAUDE|AGENTS|GEMINI)(\.local)?\.md|\.claude\/|\.mcp\.json$)|^(docs\/agents\/|docs\/REVIEW\.md$|docs\/runbooks\/rule-audit\.md$|tooling\/scripts\/src\/select-reviewers\.ts$)/i,
    reviewers: withCore('supply-chain'),
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
  // Both listings are relative to the repository root, whatever directory the script runs from.
  const [root] = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (root === undefined) throw new Error('not inside a git repository');
  const [changed, untracked] = await Promise.all([
    git(root.trim(), ['diff', '--name-only', '-z', '--no-renames', '--merge-base', base]),
    git(root.trim(), ['ls-files', '--others', '--exclude-standard', '-z']),
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
