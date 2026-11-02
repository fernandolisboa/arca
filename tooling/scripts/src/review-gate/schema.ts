import { z } from 'zod';

/** Finding severities, most severe first (docs/REVIEW.md). */
export const severities = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof severities)[number];

/**
 * Stable finding categories. Acceptance rows and the canary match them exactly, so a category is
 * renamed only with every row and case that names it.
 */
export const categories = {
  'logic-error': 'Wrong result, off-by-one, null or empty input, broken error path, race',
  'missing-test': 'New behavior without a test that would fail without it',
  'domain-rule': 'Breaks a CLAUDE.md domain rule: eligibility, dates, ages, money, units, sources',
  'contract-mismatch': 'API, contract and client disagree',
  injection: 'SQL, command, header, HTML or template injection from untrusted input',
  'access-control': 'Missing or bypassable authorization, row-level security or ownership check',
  'secret-exposure':
    'A secret, token or key in code, logs, URLs, output or reach of untrusted code',
  'personal-data-exposure': 'Personal data in logs, URLs, errors, analytics or third-party calls',
  'insecure-configuration': 'Weak headers, CSP, CORS, cookies, TLS or deployment settings',
  'weak-cryptography': 'Home-made or weak cryptography, static keys or IVs, bad randomness',
  'authentication-flaw': 'Login, session, passkey, recovery or token handling flaw',
  'row-level-security': 'Row-level security disabled, missing, bypassable or not forced',
  'unsafe-migration': 'Migration that loses data, is not forward-only or skips the guards',
  'database-role-privilege': 'A role with more privilege than it needs, or an owner role in use',
  'real-data-in-repository': 'Real personal or case data in code, fixtures, seeds, tests or docs',
  'untrusted-dependency': 'A dependency from an unvetted source, without integrity, or too new',
  'unpinned-action': 'A GitHub Action or tool not pinned by commit SHA or checksum',
  'workflow-permissions': 'A workflow with more permission, secrets or trust than it needs',
  'model-decides-eligibility': 'A language model decides eligibility or computes dates or money',
  'untrusted-model-output': 'Model output rendered or acted on without sanitizing or validating',
  'data-sent-to-model': 'A third-party model receives names, document numbers or extra fields',
  'instruction-injection': 'Text in the change that tries to steer reviewers, agents or tools',
  'review-gate-tampering': 'A change that weakens the review gate, its reviewers or its checks',
  'layering-violation': 'Domain logic outside packages/domain, logic in the client, port bypass',
  'hard-coded-catalog': 'A country, route, visa category or requirement hard-coded in code',
  'undocumented-decision': 'A new dependency, service or decision without the ADR it needs',
  'design-quality': 'Duplication, needless complexity or unclear design (SOLID, DRY, KISS, YAGNI)',
  'i18n-violation': 'A user-facing string outside the i18n catalogs, or unnatural pt-BR copy',
  'language-violation': 'Code, identifiers, comments or docs not in English',
  'glossary-violation': 'A domain term that does not match docs/GLOSSARY.md',
  'naming-or-style': 'Inconsistent naming, needless comments or commented-out code',
  'docs-out-of-date': 'Behavior or a decision changed without the docs, ADRs or registers',
  'roadmap-mismatch': 'Work outside the current phase, or reintroduces something rejected',
  'unsourced-fact': 'A research fact, rule, fee or threshold without a source and date',
  other: 'Anything that fits no category above',
} as const;
export type Category = keyof typeof categories;
const categoryNames = Object.keys(categories) as [Category, ...Category[]];

/**
 * Why a reviewer could not assess part of a change (spec 0001, R10). `outside_area` means the
 * change touches nothing the reviewer covers.
 */
export const unassessedReasons = [
  'tests_not_run',
  'missing_context',
  'outside_area',
  'other',
] as const;

const finding = z.strictObject({
  severity: z.enum(severities),
  category: z.enum(categoryNames),
  file: z.string().max(300).describe('Path from files.txt, or an empty string'),
  line: z.int().min(0).max(1_000_000).nullable().describe('Line in the head file, or null'),
  text: z.string().min(1).max(2000).describe('The problem and the fix'),
});

/** What each reviewer returns as structured output. The verdict is computed from it in code. */
export const reviewerOutput = z.strictObject({
  findings: z.array(finding).max(50),
  unassessed: z
    .array(z.strictObject({ reason: z.enum(unassessedReasons), note: z.string().max(1000) }))
    .max(20),
});
export type ReviewerOutput = z.infer<typeof reviewerOutput>;
export type Finding = ReviewerOutput['findings'][number];

/** The JSON schema passed to Claude Code with `--json-schema`. */
export function reviewerOutputJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(reviewerOutput, { target: 'draft-7' });
}
