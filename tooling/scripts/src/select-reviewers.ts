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

const docs: readonly Reviewer[] = ['spec', 'standards', 'context'];
const core: readonly Reviewer[] = ['correctness', 'security', 'architecture', ...docs];

// A path takes the reviewers of every rule it matches; a path no rule matches takes them all,
// so a new kind of file is over-reviewed rather than slipping through.
const rules: readonly Rule[] = [
  { match: /\.md$/, reviewers: docs },
  {
    match: /^(SECURITY\.md|docs\/(SECURITY|SETUP|RETENTION)\.md|docs\/(threat-models|runbooks)\/)/,
    reviewers: ['security'],
  },
  { match: /^packages\/knowledge\/data\//, reviewers: ['correctness', ...docs] },
  {
    match:
      /^(?!packages\/knowledge\/data\/)(apps|packages|tooling)\/.*\.(ts|tsx|js|mjs|cjs|css|html|json|sql|svg|png|webmanifest)$/,
    reviewers: core,
  },
  { match: /^eval\//, reviewers: [...core, 'ai-safety'] },
  {
    match: /^(apps\/api\/src\/|packages\/(db|api-contract|telemetry)\/)/,
    reviewers: [...core, 'data-access'],
  },
  {
    match:
      /^(apps\/api\/src\/(auth|account|vault)\/|packages\/vault\/|packages\/platform\/src\/(passkeys|key-storage|vault-envelopes)|apps\/web\/src\/(enrollment|recovery|passkey-json|devices)|packages\/db\/src\/(auth|step-up|enrollment|vault)-schema)/,
    reviewers: [...core, 'auth-crypto'],
  },
  {
    match:
      /^(apps\/api\/src\/intake\/|packages\/domain\/src\/intake\/|apps\/web\/src\/intake\/|apps\/api\/test\/eval\/)/,
    reviewers: [...core, 'ai-safety'],
  },
  {
    match:
      /(^|\/)(package\.json|vercel\.json|nitro\.config\.ts|eslint\.config\.js|tsconfig[^/]*\.json)$|^(pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|\.npmrc)$|^(\.github|tooling)\//,
    reviewers: [...core, 'supply-chain'],
  },
  // Agent and review configuration: changing it needs the security, architecture and
  // supply-chain reviewers (docs/REVIEW.md, "Changing reviewers").
  {
    match: /^(CLAUDE\.md|\.claude\/|docs\/agents\/|docs\/REVIEW\.md)/,
    reviewers: [...core, 'supply-chain'],
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

async function main(): Promise<void> {
  const base = process.argv[2] ?? 'origin/main';
  const { stdout } = await promisify(execFile)('git', [
    'diff',
    '--name-only',
    '-z',
    `${base}...HEAD`,
  ]);
  const paths = stdout.split('\0').filter((path) => path !== '');
  for (const { reviewer, paths: because } of selectReviewers(paths)) {
    const shown = because.slice(0, 3).join(', ');
    const more = because.length > 3 ? ` and ${String(because.length - 3)} more` : '';
    console.log(`${reviewer}-reviewer: ${shown}${more}`);
  }
}

if (import.meta.main) await main();
