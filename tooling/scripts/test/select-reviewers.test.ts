import { describe, expect, it } from 'vitest';
import { allReviewers, selectReviewers, type Reviewer } from '../src/select-reviewers.ts';

const core: Reviewer[] = [
  'correctness',
  'security',
  'architecture',
  'spec',
  'standards',
  'context',
];
const docs: Reviewer[] = ['spec', 'standards', 'context'];

function names(paths: string[]): Reviewer[] {
  return selectReviewers(paths).map((selection) => selection.reviewer);
}

describe('reviewer selection', () => {
  it.each<[string, string[], Reviewer[]]>([
    ['a doc', ['docs/ROADMAP.md'], docs],
    ['research notes', ['docs/research/ancestry.md'], docs],
    ['an ADR', ['docs/adr/0025-something.md'], docs],
    ['the security docs', ['docs/SECURITY.md'], [...docs, 'security']],
    ['a threat model', ['docs/threat-models/foundations.md'], [...docs, 'security']],
    ['the secrets guide', ['docs/SETUP.md'], [...docs, 'security']],
    ['a runbook', ['docs/runbooks/incident-response.md'], [...docs, 'security']],
    ['retention', ['docs/RETENTION.md'], [...docs, 'security']],
    ['route data', ['packages/knowledge/data/routes/pl-descent/1.json'], ['correctness', ...docs]],
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
    ['an evaluation case', ['apps/api/test/eval/intake/cases.json'], [...core, 'ai-safety']],
    ['a dependency', ['apps/web/package.json'], [...core, 'supply-chain']],
    ['the lockfile', ['pnpm-lock.yaml'], [...core, 'supply-chain']],
    ['a workflow', ['.github/workflows/ci.yml'], [...core, 'supply-chain']],
    ['deploy config', ['apps/api/vercel.json'], [...core, 'supply-chain']],
    ['a policy script', ['tooling/scripts/src/check-licenses.ts'], [...core, 'supply-chain']],
    ['CLAUDE.md', ['CLAUDE.md'], [...core, 'supply-chain']],
    ['a reviewer', ['.claude/agents/spec-reviewer.md'], [...core, 'supply-chain']],
    ['the review rules', ['docs/REVIEW.md'], [...core, 'supply-chain']],
    ['the skills config', ['docs/agents/issue-tracker.md'], [...core, 'supply-chain']],
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

  it('refuses an empty change', () => {
    expect(() => selectReviewers([])).toThrow('no changed files');
  });
});
