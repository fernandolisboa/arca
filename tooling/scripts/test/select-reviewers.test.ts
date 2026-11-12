import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const api: readonly Reviewer[] = [...core, 'data-access', 'auth-crypto', 'supply-chain'];

function names(paths: string[]): Reviewer[] {
  return selectReviewers(paths).map((selection) => selection.reviewer);
}

describe('reviewer selection', () => {
  it.each<[string, string[], readonly Reviewer[]]>([
    ['a doc', ['docs/ROADMAP.md'], docs],
    ['research notes', ['docs/research/ancestry.md'], docs],
    ['route notes', ['docs/research/routes/pl-descent.md'], [...docs, 'security']],
    [
      'route notes in a folder below',
      ['docs/research/routes/archive/pl-descent.md'],
      [...docs, 'security'],
    ],
    [
      'another kind of file beside the route notes',
      ['docs/research/routes/pl-descent.json'],
      allReviewers,
    ],
    ['the security docs', ['docs/SECURITY.md'], [...docs, 'security']],
    ['a threat model', ['docs/threat-models/foundations.md'], [...docs, 'security']],
    ['the secrets guide', ['docs/SETUP.md'], [...docs, 'security']],
    ['a runbook', ['docs/runbooks/incident-response.md'], [...docs, 'security']],
    ['the rule audit runbook', ['docs/runbooks/rule-audit.md'], [...core, 'supply-chain']],
    ['the corrector script', ['tooling/scripts/src/corrector.ts'], [...core, 'supply-chain']],
    [
      'the reading recipes',
      ['docs/runbooks/reading-recipes.md'],
      [...docs, 'security', 'supply-chain'],
    ],
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
    ['an API route', ['apps/api/src/case/routes.ts'], api],
    ['the schema', ['packages/db/src/case-schema.ts'], [...core, 'data-access', 'auth-crypto']],
    [
      'a migration',
      ['packages/db/migrations/0042_case.sql'],
      [...core, 'data-access', 'auth-crypto'],
    ],
    ['telemetry', ['packages/telemetry/src/scrub.ts'], [...core, 'data-access']],
    [
      'the API contract',
      ['packages/api-contract/src/routes/case.ts'],
      [...core, 'data-access', 'auth-crypto'],
    ],
    ['sign-in', ['apps/api/src/auth/passkeys.ts'], api],
    ['the vault', ['packages/vault/src/envelope.ts'], [...core, 'auth-crypto']],
    ['a passkey port', ['packages/platform/src/passkeys.ts'], [...core, 'auth-crypto']],
    ['recovery on the web', ['apps/web/src/recovery.ts'], [...core, 'auth-crypto', 'data-access']],
    ['the intake adapter', ['apps/api/src/intake/claude.ts'], [...api, 'ai-safety']],
    ['the intake draft', ['packages/domain/src/intake/draft.ts'], [...core, 'ai-safety']],
    ['an evaluation case', ['apps/api/test/eval/intake/cases.json'], [...api, 'ai-safety']],
    ['a dependency', ['apps/web/package.json'], [...core, 'supply-chain']],
    ['the lockfile', ['pnpm-lock.yaml'], [...core, 'supply-chain']],
    ['a workflow', ['.github/workflows/ci.yml'], [...core, 'supply-chain']],
    ['deploy config', ['apps/api/vercel.json'], api],
    ['a policy script', ['tooling/scripts/src/check-licenses.ts'], [...core, 'supply-chain']],
    ['CLAUDE.md', ['CLAUDE.md'], [...core, 'supply-chain']],
    ['a reviewer', ['.claude/agents/spec-reviewer.md'], [...core, 'supply-chain']],
    ['the review rules', ['docs/REVIEW.md'], [...core, 'supply-chain']],
    ['the skills config', ['docs/agents/issue-tracker.md'], [...core, 'supply-chain']],
    [
      'an ADR',
      ['docs/adr/0026-something.md'],
      [...docs, 'security', 'architecture', 'supply-chain', 'auth-crypto'],
    ],
    [
      'the data-flow register',
      ['docs/ARCHITECTURE.md'],
      [...docs, 'security', 'architecture', 'supply-chain', 'auth-crypto'],
    ],
    ['the official domains', ['packages/knowledge/data/official-domains/us.json'], core],
    ['vendored data', ['packages/knowledge/vendor/countries.json'], [...core, 'supply-chain']],
    ['a passkey adapter', ['packages/platform/src/web-passkeys.ts'], [...core, 'auth-crypto']],
    [
      'client key storage',
      ['packages/platform/src/web-key-storage.ts'],
      [...core, 'data-access', 'auth-crypto'],
    ],
    ['the web vault', ['apps/web/src/vault-session.ts'], [...core, 'auth-crypto', 'data-access']],
    ['a step-up', ['apps/web/src/step-up.ts'], [...core, 'auth-crypto', 'data-access']],
    ['the sign-in screen', ['apps/web/src/routes/sign-in.tsx'], [...core, 'auth-crypto']],
    ['the vault screen', ['apps/web/src/routes/vault.lazy.tsx'], [...core, 'auth-crypto']],
    ['sharing', ['apps/web/src/sharing.ts'], [...core, 'data-access', 'auth-crypto']],
    ['a knowledge-base decision', ['apps/api/src/knowledge/decisions.ts'], api],
    [
      'the admin decision screen',
      ['apps/web/src/knowledge/decision.tsx'],
      [...core, 'data-access', 'auth-crypto'],
    ],
    ['the admin role', ['apps/web/src/admins.ts'], [...core, 'data-access', 'auth-crypto']],
    ['the owner list', ['apps/api/src/knowledge/owner-list.ts'], api],
    ['the access matrix', ['apps/api/test/postgres/every-table.ts'], api],
    [
      'a database e2e test',
      ['apps/web/e2e/postgres/vault.spec.ts'],
      [...core, 'data-access', 'auth-crypto'],
    ],
    [
      'client telemetry',
      ['apps/web/src/monitoring.ts'],
      [...core, 'data-access', 'supply-chain', 'auth-crypto'],
    ],
    ['the email sender', ['apps/api/src/email/send.ts'], api],
    ['the intake screen', ['apps/web/src/routes/family_.intake.tsx'], [...core, 'ai-safety']],
    ['an intake test', ['apps/api/test/intake-prompt.test.ts'], [...api, 'ai-safety']],
    ['the evaluation config', ['apps/api/vitest.eval.config.ts'], [...api, 'ai-safety']],
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
    ['a nested CLAUDE.md', ['docs/specs/CLAUDE.md'], [...core, 'supply-chain']],
    [
      'enrollment is not a model',
      ['packages/ui/src/enrollment-step.tsx'],
      [...core, 'auth-crypto'],
    ],
    ['an LLM port', ['packages/domain/src/llm/port.ts'], [...core, 'ai-safety']],
    ['an LLM file', ['packages/domain/src/explain.llm.ts'], [...core, 'ai-safety']],
    ['mixed-case agent config', ['docs/x/.Claude/settings.json'], [...core, 'supply-chain']],
    ['a lowercase claude.md', ['docs/claude.md'], [...core, 'supply-chain']],
    ['a nested skill', ['docs/x/.claude/skills/y/SKILL.md'], [...core, 'supply-chain']],
    ['AGENTS.md', ['AGENTS.md'], [...core, 'supply-chain']],
    ['this selector', ['tooling/scripts/src/select-reviewers.ts'], [...core, 'supply-chain']],
    ['the vault format', ['docs/vault-format.md'], [...docs, 'security', 'auth-crypto']],
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

// Real files in this repository and a specialist each must get; the sweep fails if one is moved,
// so the list cannot drift from the code it protects.
const sensitive: readonly (readonly [string, Reviewer])[] = [
  ['apps/api/src/app.ts', 'auth-crypto'],
  ['apps/api/src/app.ts', 'supply-chain'],
  ['apps/api/src/server.ts', 'auth-crypto'],
  ['apps/api/src/config.ts', 'supply-chain'],
  ['apps/api/src/production-site.ts', 'supply-chain'],
  ['apps/api/src/notification/vapid.ts', 'auth-crypto'],
  ['apps/api/src/knowledge/decisions.ts', 'auth-crypto'],
  ['apps/api/test/postgres/every-table.ts', 'data-access'],
  ['apps/web/src/knowledge/decision.tsx', 'data-access'],
  ['apps/web/src/knowledge/version-panel.tsx', 'auth-crypto'],
  ['apps/web/src/monitoring.ts', 'data-access'],
  ['apps/web/src/monitoring.ts', 'supply-chain'],
  ['apps/web/src/use-link-token.ts', 'auth-crypto'],
  ['apps/web/src/pwa/trusted-types.ts', 'supply-chain'],
  ['apps/web/src/service-worker/sw.ts', 'supply-chain'],
  ['apps/web/src/vault.ts', 'auth-crypto'],
  ['apps/web/src/routes/recover.tsx', 'auth-crypto'],
  ['apps/web/src/routes/family_.intake.tsx', 'ai-safety'],
  ['apps/web/vite.config.ts', 'supply-chain'],
  ['packages/platform/src/framing.ts', 'auth-crypto'],
  ['packages/platform/src/web-key-storage.ts', 'auth-crypto'],
  ['packages/platform/test/fixtures/fido2prf-vector.ts', 'auth-crypto'],
  ['packages/telemetry/src/sentry.ts', 'data-access'],
  ['packages/domain/src/rules/decisions.ts', 'auth-crypto'],
  ['packages/db/test/postgres/registry.test.ts', 'data-access'],
  ['tooling/scripts/test/postgres/access.test.ts', 'data-access'],
  ['tooling/scripts/test/postgres/access.test.ts', 'auth-crypto'],
  ['tooling/scripts/test/db-policy.test.ts', 'data-access'],
  ['.github/workflows/intake-eval.yml', 'ai-safety'],
  ['packages/domain/src/rules/catalog.ts', 'data-access'],
  ['packages/knowledge/src/catalog.ts', 'data-access'],
  ['packages/knowledge/src/reproduction.ts', 'data-access'],
  ['apps/web/src/signed-in-notice.tsx', 'auth-crypto'],
  ['apps/web/index.html', 'supply-chain'],
  ['packages/knowledge/data/hashes.json', 'auth-crypto'],
  ['tooling/scripts/src/db/guards.ts', 'auth-crypto'],
  ['packages/api-contract/src/routes/index.ts', 'auth-crypto'],
  ['packages/db/src/rate-limit-schema.ts', 'auth-crypto'],
  ['packages/knowledge/scripts/content-hash.ts', 'auth-crypto'],
  ['apps/web/src/case.ts', 'auth-crypto'],
  ['apps/web/src/main.tsx', 'supply-chain'],
  ['apps/web/e2e/servers.ts', 'data-access'],
  ['docs/adr/0018-vault-encryption.md', 'auth-crypto'],
  ['packages/db/migrations/20261104044314_step_up/migration.sql', 'auth-crypto'],
  ['apps/web/src/sign-in.ts', 'auth-crypto'],
  ['apps/api/src/knowledge/admin-grants.ts', 'auth-crypto'],
  ['apps/api/src/knowledge/admin-grants.ts', 'data-access'],
  ['apps/web/src/admins.ts', 'auth-crypto'],
  ['docs/research/routes/us-eb5.md', 'security'],
  ['docs/runbooks/rule-audit.md', 'supply-chain'],
  ['docs/runbooks/rule-audit.md', 'architecture'],
  ['docs/runbooks/reading-recipes.md', 'supply-chain'],
  ['tooling/scripts/src/corrector.ts', 'supply-chain'],
];

describe('sensitive files in this repository', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));

  it.each(sensitive)('%s gets the %s reviewer', (path, reviewer) => {
    expect(existsSync(join(root, path)), `${path} moved: update this list`).toBe(true);
    expect(names([path])).toContain(reviewer);
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

    const expected = ['README.md', 'docs/key.md', 'new.ts', 'packages/vault/key.ts'];
    expect((await changedPaths('main', dir)).sort()).toEqual(expected);
    expect((await changedPaths('main', join(dir, 'docs'))).sort()).toEqual(expected);
  });
});
