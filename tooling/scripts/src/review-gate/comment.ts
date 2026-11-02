import type { Finding } from './schema.ts';
import {
  failsGate,
  type CanaryStatus,
  type GateVerdict,
  type ReviewerJudgement,
} from './verdict.ts';

/** Marks the gate's comment so a new run updates it instead of adding another. */
export const commentMarker = '<!-- arca-review-gate -->';
const maxLength = 60_000;
const zeroWidthSpace = '​';

/**
 * Makes model-written text inert in a GitHub comment: no Markdown, HTML, links, images, mentions
 * or issue references. Each finding is one line, so a newline cannot start a new block.
 */
export function inert(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/(?:https?|ftp|mailto|data|javascript):\S*/gi, '[link removed]')
    .replace(/\bwww\.\S+/gi, '[link removed]')
    .replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] ?? char)
    .replace(/[\\`*_{}[\]()#+\-.!|~^]/g, '\\$&')
    .replace(/@/g, `@${zeroWidthSpace}`)
    .replace(/(?<=#)(?=\d)/g, zeroWidthSpace)
    .replace(/\b(GH\\?-)(?=\d)/gi, `$1${zeroWidthSpace}`)
    .trim();
}

const outcomeLabel: Record<ReviewerJudgement['outcome'], string> = {
  pass: 'PASS',
  block: 'BLOCK',
  missing: 'no output',
  invalid: 'invalid output',
};

function findingLine(finding: Finding, note: string): string {
  const where =
    finding.file === ''
      ? ''
      : ` ${inert(finding.file)}${finding.line === null ? '' : `:${String(finding.line)}`}`;
  return `- **${finding.severity}** \`${finding.category}\`${where}${note}: ${inert(finding.text)}`;
}

/** The gate's comment, built only from schema fields; the canary detail is our own text. */
export function renderComment(input: {
  readonly headSha: string;
  readonly judgements: readonly ReviewerJudgement[];
  readonly canary: CanaryStatus;
  readonly verdict: GateVerdict;
}): string {
  const { headSha, judgements, canary, verdict } = input;
  const lines = [
    commentMarker,
    `## Review gate: ${verdict.pass ? 'pass' : 'fail'}`,
    '',
    `Reviewed commit \`${headSha}\`. A new push needs a new verdict.`,
    '',
    '| Reviewer | Weight | Verdict | Fails the gate |',
    '| --- | --- | --- | --- |',
    ...judgements.map(
      (judgement) =>
        `| ${judgement.reviewer} | ${judgement.mustPass ? 'must pass' : 'should pass'} | ${outcomeLabel[judgement.outcome]} | ${failsGate(judgement) ? 'yes' : 'no'} |`,
    ),
    '',
    canary.state === 'passed'
      ? 'Canary: passed for the current gate.'
      : `Canary: ${canary.state}. ${canary.detail}`,
  ];
  for (const judgement of judgements) {
    const findings = judgement.output?.findings ?? [];
    const unassessed = judgement.output?.unassessed ?? [];
    if (findings.length === 0 && unassessed.length === 0) continue;
    lines.push('', `### ${judgement.reviewer}`, '');
    for (const finding of findings) {
      const note = judgement.accepted.includes(finding) ? ' (accepted)' : '';
      lines.push(findingLine(finding, note));
    }
    for (const entry of unassessed) {
      lines.push(`- **unassessed** \`${entry.reason}\`: ${inert(entry.note)}`);
    }
  }
  const comment = `${lines.join('\n')}\n`;
  return comment.length <= maxLength
    ? comment
    : `${comment.slice(0, maxLength)}\n\nThe rest is cut; the check run has the verdict.\n`;
}
