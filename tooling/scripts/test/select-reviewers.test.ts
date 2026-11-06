import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  allReviewers,
  changedPaths,
  coreReviewers as core,
  docsReviewers as docs,
  selectReviewers,
  type Reviewer,
} from '../src/select-reviewers.ts';

function names(paths: string[]): Reviewer[] {
  return selectReviewers(paths).map((selection) => selection.reviewer);
}

describe('reviewer selection', () => {
  it.each<[string, string[], readonly Reviewer[]]>([
    ['a doc', ['docs/ROADMAP.md'], docs],
    ['research notes', ['docs/research/ancestry.md'], docs],
    ['the security docs', ['docs/SECURITY.md'], [...docs, 'security']],
    ['a threat model', ['docs/threat-models/foundations.md'], [...docs, 'security']],
    ['the secrets guide', ['docs/SETUP.md'], [...docs, 'security']],
    ['a runbook', ['docs/runbooks/incident-response.md'], [...docs, 'security']],
    ['retention', ['docs/RETENTION.md'], [...docs, 'security']],
    ['route data', ['packages/knowledge/data/routes/pl-descent/1.json'], core],
    ['code beside route data', ['packages/knowledge/data/loader.ts'], core],
    [
      'a prompt kept as markdown',
      ['packages/domain/src/prompts/explain.md'],
      [...core, 'ai-safety'],
    ],
    ['other markdown beside code', ['packages/ui/notes.md'], allReviewers],
    [
      'knowledge-base decisions',
      ['packages/domain/src/rules/decisions.ts'],
      [...core, 'data-access', 'auth-crypto'],
    ],
    ['domain code', ['packages/domain/src/rules/evaluate.ts'], core],
    ['a web screen', ['apps/web/src/questions/person.tsx'], core],
    ['a pt-BR string', ['packages/i18n/src/catalogs/pt-BR.ts'], core],
    ['an API route', ['apps/api/src/case/routes.ts'], [...core, 'data-access']],
    ['the schema', ['packages/db/src/case-schema.ts'], [...core, 'data-access']],
    ['a migration', ['packages/db/migrations/0042_case.sql'], [...core, 'data-access']],
    ['telemetry', ['packages/telemetry/src/scrub.ts'], [...core, 'data-access']],
    ['the API contract', ['packages/api-contract/src/routes/case.ts'], [...core, 'data-access']],
    ['sign-in', ['apps/api/src/auth/passkeys.ts'], [...core, 'data-access', 'auth-crypto']],
    ['the vault', ['packages/vault/src/envelope.ts'], [...core, 'auth-crypto']],
    ['a passkey port', ['packages/platform/src/passkeys.ts'], [...core, 'auth-crypto']],
    ['recovery on the web', ['apps/web/src/recovery.ts'], [...core, 'auth-crypto']],
    [
      'the intake adapter',
      ['apps/api/src/intake/claude.ts'],
      [...core, 'data-access', 'ai-safety'],
    ],
    ['the intake draft', ['packages/domain/src/intake/draft.ts'], [...core, 'ai-safety']],
    [
      'an evaluation case',
      ['apps/api/test/eval/intake/cases.json'],
      [...core, 'data-access', 'ai-safety'],
    ],
    ['a dependency', ['apps/web/package.json'], [...core, 'supply-chain']],
    ['the lockfile', ['pnpm-lock.yaml'], [...core, 'supply-chain']],
    ['a workflow', ['.github/workflows/ci.yml'], [...core, 'supply-chain']],
    ['deploy config', ['apps/api/vercel.json'], [...core, 'data-access', 'supply-chain']],
    ['a policy script', ['tooling/scripts/src/check-licenses.ts'], [...core, 'supply-chain']],
    ['CLAUDE.md', ['CLAUDE.md'], [...core, 'supply-chain']],
    ['a reviewer', ['.claude/agents/spec-reviewer.md'], [...core, 'supply-chain']],
    ['the review rules', ['docs/REVIEW.md'], [...core, 'supply-chain']],
    ['the skills config', ['docs/agents/issue-tracker.md'], [...core, 'supply-chain']],
    [
      'an ADR',
      ['docs/adr/0026-something.md'],
      [...docs, 'security', 'architecture', 'supply-chain'],
    ],
    [
      'the data-flow register',
      ['docs/ARCHITECTURE.md'],
      [...docs, 'security', 'architecture', 'supply-chain'],
    ],
    ['the official domains', ['packages/knowledge/data/official-domains/us.json'], core],
    ['vendored data', ['packages/knowledge/vendor/countries.json'], [...core, 'supply-chain']],
    ['a passkey adapter', ['packages/platform/src/web-passkeys.ts'], [...core, 'auth-crypto']],
    [
      'client key storage',
      ['packages/platform/src/web-key-storage.ts'],
      [...core, 'data-access', 'auth-crypto'],
    ],
    ['the web vault', ['apps/web/src/vault-session.ts'], [...core, 'auth-crypto']],
    ['a step-up', ['apps/web/src/step-up.ts'], [...core, 'auth-crypto']],
    ['the sign-in screen', ['apps/web/src/routes/sign-in.tsx'], [...core, 'auth-crypto']],
    ['the vault screen', ['apps/web/src/routes/vault.lazy.tsx'], [...core, 'auth-crypto']],
    ['sharing', ['apps/web/src/sharing.ts'], [...core, 'data-access', 'auth-crypto']],
    [
      'a knowledge-base decision',
      ['apps/api/src/knowledge/decisions.ts'],
      [...core, 'data-access', 'auth-crypto'],
    ],
    [
      'the approver screen',
      ['apps/web/src/knowledge/approver-section.tsx'],
      [...core, 'data-access', 'auth-crypto'],
    ],
    ['the access matrix', ['apps/api/test/postgres/every-table.ts'], [...core, 'data-access']],
    [
      'a database e2e test',
      ['apps/web/e2e/postgres/vault.spec.ts'],
      [...core, 'data-access', 'auth-crypto'],
    ],
    ['client telemetry', ['apps/web/src/monitoring.ts'], [...core, 'data-access', 'supply-chain']],
    ['the email sender', ['apps/api/src/email/send.ts'], [...core, 'data-access', 'supply-chain']],
    ['the intake screen', ['apps/web/src/routes/family_.intake.tsx'], [...core, 'ai-safety']],
    [
      'an intake test',
      ['apps/api/test/intake-prompt.test.ts'],
      [...core, 'data-access', 'ai-safety'],
    ],
    [
      'the evaluation config',
      ['apps/api/vitest.eval.config.ts'],
      [...core, 'data-access', 'ai-safety', 'supply-chain'],
    ],
    [
      'the evaluation workflow',
      ['.github/workflows/intake-eval.yml'],
      [...core, 'ai-safety', 'supply-chain'],
    ],
    ['the web build config', ['apps/web/vite.config.ts'], [...core, 'supply-chain']],
    ['the rules engine', ['packages/domain/src/rules/evaluate.ts'], core],
    [
      'a database script',
      ['tooling/scripts/src/db/runtime-config.ts'],
      [...core, 'data-access', 'supply-chain'],
    ],
  ])('picks the reviewers for %s', (_label, paths, expected) => {
    expect(names(paths)).toEqual(allReviewers.filter((reviewer) => expected.includes(reviewer)));
  });

  it('joins the reviewers of every path', () => {
    expect(names(['docs/ROADMAP.md', 'packages/vault/src/envelope.ts'])).toEqual(
      allReviewers.filter((reviewer) => [...core, 'auth-crypto'].includes(reviewer)),
    );
  });

  it('runs every reviewer when a path matches no rule', () => {
    expect(names(['docs/ROADMAP.md', 'somewhere-new/thing.bin'])).toEqual(allReviewers);
  });

  it('says which paths brought each reviewer in', () => {
    const selection = selectReviewers(['docs/ROADMAP.md', 'apps/api/src/vault/routes.ts']);
    expect(selection.find((entry) => entry.reviewer === 'auth-crypto')?.paths).toEqual([
      'apps/api/src/vault/routes.ts',
    ]);
    expect(selection.find((entry) => entry.reviewer === 'context')?.paths).toEqual([
      'docs/ROADMAP.md',
      'apps/api/src/vault/routes.ts',
    ]);
  });

  it('refuses a base that git would read as an option', async () => {
    await expect(changedPaths('--output=x')).rejects.toThrow('not a git revision');
  });

  it('refuses an empty change', () => {
    expect(() => selectReviewers([])).toThrow('no changed files');
  });
});

describe('changed paths', () => {
  const git = async (cwd: string, ...args: string[]) => {
    await promisify(execFile)('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd,
    });
  };

  it('lists both sides of a rename, uncommitted edits and untracked files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arca-reviewers-'));
    await git(dir, 'init', '-q', '-b', 'main');
    await mkdir(join(dir, 'packages/vault'), { recursive: true });
    await mkdir(join(dir, 'docs'));
    await writeFile(join(dir, 'packages/vault/key.ts'), 'export const key = 1;\n');
    await writeFile(join(dir, 'README.md'), 'readme\n');
    await git(dir, 'add', '.');
    await git(dir, 'commit', '-q', '-m', 'base');
    await git(dir, 'switch', '-q', '-c', 'change');
    await rename(join(dir, 'packages/vault/key.ts'), join(dir, 'docs/key.md'));
    await git(dir, 'add', '-A');
    await git(dir, 'commit', '-q', '-m', 'move');
    await writeFile(join(dir, 'README.md'), 'edited\n');
    await writeFile(join(dir, 'new.ts'), 'export {};\n');

    expect((await changedPaths('main', dir)).sort()).toEqual([
      'README.md',
      'docs/key.md',
      'new.ts',
      'packages/vault/key.ts',
    ]);
  });
});
