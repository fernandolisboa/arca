import {
  type CaseScore,
  type Field,
  type Tally,
  fields,
  precision,
  recall,
  totals,
} from './score.js';

/** The scores of the accepted setup (spec 0008, R5); `null` until the first run is accepted. */
export interface Baseline {
  readonly model: string | null;
  readonly promptVersion: string | null;
  readonly precision: number | null;
  readonly recall: number | null;
}

export interface CaseRun {
  readonly id: string;
  readonly score: CaseScore;
  /** The failure code when the case got no draft, scored then as all missed. */
  readonly failure?: string;
  /** Text the masking should have kept from the extractor but did not. */
  readonly leaked: readonly string[];
  /** The wrong facts the case forbids that the draft proposed. */
  readonly forbidden: readonly string[];
}

export interface Verdict {
  readonly precision: number;
  readonly recall: number;
  readonly problems: string[];
}

/** Precision may fall at most this far below the baseline (spec 0008, R5). */
export const allowedDrop = 0.02;
/** Whatever the baseline, a run below this precision does not pass. */
export const precisionFloor = 0.9;
/**
 * And below this recall, since a model that proposes nothing is never wrong. The floors differ
 * because a wrong fact is worse than a question left for the guided flow.
 */
export const recallFloor = 0.6;
/** More cases than this with no draft and the run says too little about the model. */
export const maxFailures = 2;

const round = (value: number) => Math.round(value * 1000) / 1000;

export function judge(runs: readonly CaseRun[], baseline: Baseline): Verdict {
  const all = totals(runs.map(({ score }) => score)).all;
  const scored = { precision: round(precision(all)), recall: round(recall(all)) };
  const problems: string[] = [];
  for (const { id, leaked, forbidden } of runs) {
    if (leaked.length > 0) {
      problems.push(`${id}: the masking let ${String(leaked.length)} item(s) through`);
    }
    if (forbidden.length > 0) problems.push(`${id}: proposed ${forbidden.join(', ')}`);
  }
  const failed = runs.filter(({ failure }) => failure !== undefined);
  if (failed.length > maxFailures) {
    problems.push(`${String(failed.length)} cases got no draft (at most ${String(maxFailures)})`);
  }
  if (scored.precision < precisionFloor) {
    problems.push(
      `precision ${String(scored.precision)} is below the floor ${String(precisionFloor)}`,
    );
  }
  if (scored.recall < recallFloor) {
    problems.push(`recall ${String(scored.recall)} is below the floor ${String(recallFloor)}`);
  }
  if (baseline.precision !== null && scored.precision < baseline.precision - allowedDrop) {
    problems.push(
      `precision ${String(scored.precision)} fell more than ${String(allowedDrop)} below the baseline ${String(baseline.precision)}`,
    );
  }
  return { ...scored, problems };
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const row = (name: string, tally: Tally) =>
  `| ${name} | ${String(tally.hits)} | ${String(tally.wrong)} | ${String(tally.missed)} | ${percent(precision(tally))} | ${percent(recall(tally))} |`;

/** The run as Markdown, for the job summary: scores per field, then each case's misses. */
export function report(
  runs: readonly CaseRun[],
  baseline: Baseline,
  verdict: Verdict,
  setup: { readonly model: string; readonly promptVersion: string },
): string {
  const sums = totals(runs.map(({ score }) => score));
  const lines = [
    '## Intake evaluation',
    '',
    `Model \`${setup.model}\`, prompt \`${setup.promptVersion}\`, ${String(runs.length)} cases.`,
    verdict.problems.length === 0 ? '**Passed.**' : `**Failed:** ${verdict.problems.join('; ')}.`,
    baseline.precision === null
      ? 'No baseline yet: record the scores below in `baseline.json` once this run is accepted.'
      : `Baseline: precision ${percent(baseline.precision)}, recall ${baseline.recall === null ? '?' : percent(baseline.recall)} (\`${baseline.model ?? '?'}\`, \`${baseline.promptVersion ?? '?'}\`).`,
    '',
    '| Field | Right | Wrong | Missed | Precision | Recall |',
    '| --- | --- | --- | --- | --- | --- |',
    ...fields.map((field: Field) => row(field, sums[field])),
    row('**all**', sums.all),
    '',
  ];
  const notable = runs.filter(
    ({ score, failure, leaked }) =>
      failure !== undefined || leaked.length > 0 || score.wrong.length + score.missed.length > 0,
  );
  if (notable.length > 0) {
    lines.push('### Cases with differences', '');
    for (const { id, score, failure, leaked } of notable) {
      lines.push(`- **${id}**${failure === undefined ? '' : ` (no draft: \`${failure}\`)`}`);
      if (leaked.length > 0)
        lines.push(`  - leaked to the extractor: ${String(leaked.length)} item(s)`);
      for (const key of score.wrong) lines.push(`  - wrong: \`${key}\``);
      for (const key of score.missed) lines.push(`  - missed: \`${key}\``);
    }
    lines.push('');
  }
  const accepted: Baseline = {
    model: setup.model,
    promptVersion: setup.promptVersion,
    precision: verdict.precision,
    recall: verdict.recall,
  };
  lines.push('Baseline for this run:', '', '```json', JSON.stringify(accepted, null, 2), '```');
  return lines.join('\n');
}
