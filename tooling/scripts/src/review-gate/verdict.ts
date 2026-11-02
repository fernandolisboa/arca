import type { Acceptance } from './acceptances.ts';
import { reviewerOutput, type Finding, type ReviewerOutput } from './schema.ts';

export interface ReviewerJudgment {
  readonly reviewer: string;
  readonly mustPass: boolean;
  /** `missing` and `invalid` mean no usable output; `block` and `pass` are the reviewer's verdict. */
  readonly outcome: 'pass' | 'block' | 'missing' | 'invalid';
  readonly output: ReviewerOutput | undefined;
  /** Findings that make this reviewer block: critical, high, and medium without an acceptance. */
  readonly blocking: readonly Finding[];
  /** Medium findings an acceptance row covers. */
  readonly accepted: readonly Finding[];
  /** Unassessed entries that make this reviewer block (anything but `tests_not_run`). */
  readonly unassessed: readonly ReviewerOutput['unassessed'][number][];
}

/** Parses a reviewer's raw structured output; anything that does not match the schema is invalid. */
export function parseReviewerOutput(
  raw: string | undefined,
): ReviewerOutput | 'missing' | 'invalid' {
  if (raw === undefined || raw.trim() === '') return 'missing';
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return 'invalid';
  }
  const parsed = reviewerOutput.safeParse(data);
  return parsed.success ? parsed.data : 'invalid';
}

/**
 * One reviewer's verdict (spec 0001, R10): critical and high findings block; a medium blocks unless
 * an acceptance row for this pull request matches reviewer, file and category exactly; an
 * unassessed entry other than `tests_not_run` blocks.
 */
export function judgeReviewer(
  reviewer: { readonly name: string; readonly mustPass: boolean },
  raw: string | undefined,
  acceptances: readonly Acceptance[],
  pullRequest: number | undefined,
): ReviewerJudgment {
  const parsed = parseReviewerOutput(raw);
  const base = { reviewer: reviewer.name, mustPass: reviewer.mustPass };
  if (parsed === 'missing' || parsed === 'invalid') {
    return {
      ...base,
      outcome: parsed,
      output: undefined,
      blocking: [],
      accepted: [],
      unassessed: [],
    };
  }

  const isAccepted = (finding: Finding) =>
    acceptances.some(
      (row) =>
        row.pullRequest === pullRequest &&
        row.reviewer === reviewer.name &&
        row.file === finding.file &&
        row.category === finding.category,
    );
  const mediums = parsed.findings.filter((finding) => finding.severity === 'medium');
  const accepted = mediums.filter(isAccepted);
  const blocking = parsed.findings.filter(
    (finding) =>
      finding.severity === 'critical' ||
      finding.severity === 'high' ||
      (finding.severity === 'medium' && !accepted.includes(finding)),
  );
  const unassessed = parsed.unassessed.filter((entry) => entry.reason !== 'tests_not_run');
  const outcome = blocking.length > 0 || unassessed.length > 0 ? 'block' : 'pass';
  return { ...base, outcome, output: parsed, blocking, accepted, unassessed };
}

/**
 * Whether a reviewer's judgment fails the gate. Missing or invalid output fails for every
 * reviewer, and so do critical and high findings; a should-pass reviewer never blocks alone on a
 * medium finding or an unassessed entry (docs/REVIEW.md).
 */
export function failsGate(judgment: ReviewerJudgment): boolean {
  if (judgment.outcome === 'missing' || judgment.outcome === 'invalid') return true;
  if (judgment.mustPass) return judgment.outcome === 'block';
  return judgment.blocking.some(
    (finding) => finding.severity === 'critical' || finding.severity === 'high',
  );
}

export type CanaryStatus =
  { readonly state: 'passed' } | { readonly state: 'failed' | 'missing'; readonly detail: string };

export interface GateVerdict {
  readonly pass: boolean;
  readonly failing: readonly string[];
}

/** The gate fails when any reviewer fails it or the canary did not pass. */
export function judgeGate(
  judgments: readonly ReviewerJudgment[],
  canary: CanaryStatus,
): GateVerdict {
  const failing = judgments.filter(failsGate).map((judgment) => judgment.reviewer);
  return { pass: failing.length === 0 && canary.state === 'passed', failing };
}
