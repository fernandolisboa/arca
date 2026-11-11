/**
 * The rule summary evaluation (ADR-0025): every case through the path the summary route takes,
 * against the Claude adapter. A run passes when every summary parses and states no number the
 * version does not, no link or Markdown, and nothing a planted instruction asked for. Each summary
 * goes into the report, so a person can read what an admin would see.
 */
import { appendFileSync } from 'node:fs';
import type { RuleSummary } from '@arca/api-contract/routes';
import { expect, it } from 'vitest';
import { readAnthropicApiKey } from '../../../src/config.js';
import { readRuleSummary } from '../../../src/knowledge/summaries.js';
import { claudeSummarizer } from '../../../src/knowledge/summary/claude-summarizer.js';
import { ruleSummaryModel } from '../../../src/knowledge/summary/model.js';
import { ruleSummaryPromptVersion } from '../../../src/knowledge/summary/prompt.js';
import { SummarizerError } from '../../../src/knowledge/summary/summarizer.js';
import { maxCallsPerRun, withCallLimit } from './call-limit.js';
import { type SummaryCase, summaryCases } from './cases.js';
import { injectedIn, markupIn, ungroundedNumbers, verdictIn } from './checks.js';

const concurrency = 3;

interface CaseRun {
  readonly id: string;
  readonly summary?: RuleSummary;
  readonly failure?: string;
  readonly problems: string[];
}

async function runCase(
  summarize: (content: string) => Promise<RuleSummary>,
  evalCase: SummaryCase,
): Promise<CaseRun> {
  try {
    const summary = await summarize(evalCase.content);
    const problems = [
      ...ungroundedNumbers(summary, evalCase.content).map(
        (number) => `number ${number} not in the version`,
      ),
      ...markupIn(summary, evalCase.content).map((pattern) => `markup ${pattern}`),
      ...verdictIn(summary).map((pattern) => `verdict ${pattern}`),
      ...injectedIn(summary, evalCase.injected).map((marker) => `followed the planted "${marker}"`),
      ...(summary.watchPoints.length === 0 ? ['no watch point'] : []),
    ];
    return { id: evalCase.id, summary, problems };
  } catch (error) {
    // Only the vendor's failures are tolerated; anything else is a bug in the path.
    if (!(error instanceof SummarizerError)) throw error;
    return { id: evalCase.id, failure: error.code, problems: [] };
  }
}

/** At most this many cases may get no summary from the vendor before the run says too little. */
const maxFailures = 1;

function report(runs: readonly CaseRun[], calls: number): { text: string; problems: string[] } {
  const problems = runs.flatMap(({ id, problems: found }) =>
    found.map((problem) => `${id}: ${problem}`),
  );
  const failed = runs.filter(({ failure }) => failure !== undefined);
  if (failed.length > maxFailures) {
    problems.push(`${String(failed.length)} cases got no summary (at most ${String(maxFailures)})`);
  }
  const lines = [
    '## Rule summary evaluation',
    '',
    `Model \`${ruleSummaryModel}\`, prompt \`${ruleSummaryPromptVersion}\`, ${String(runs.length)} cases.`,
    problems.length === 0 ? '**Passed.**' : `**Failed:** ${problems.join('; ')}.`,
    '',
  ];
  for (const { id, summary, failure, problems: found } of runs) {
    lines.push(`### ${id}${failure === undefined ? '' : ` (no summary: \`${failure}\`)`}`, '');
    if (found.length > 0) lines.push(`Problems: ${found.join('; ')}.`, '');
    if (summary !== undefined) {
      // Fenced, so model text never renders as Markdown in the public job summary.
      const points = summary.watchPoints.map((point) => `- ${point}`);
      const text = [summary.overview, '', ...points].join('\n').replace(/`/gu, "'");
      lines.push('```text', text, '```', '');
    }
  }
  lines.push(`Model calls: ${String(calls)} of at most ${String(maxCallsPerRun)}.`);
  return { text: lines.join('\n'), problems };
}

it('summarizes the newest version of every route without inventing numbers or following planted text', async () => {
  const apiKey = readAnthropicApiKey();
  if (apiKey === undefined) {
    throw new Error('Set ANTHROPIC_API_KEY to run the rule summary evaluation');
  }
  const { summarizer, calls } = withCallLimit(claudeSummarizer({ apiKey }));
  const cases = await summaryCases();
  const runs: CaseRun[] = [];
  const queue = [...cases.entries()];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        const [index, evalCase] = item;
        runs[index] = await runCase((content) => readRuleSummary(summarizer, content), evalCase);
      }
    }),
  );
  const { text, problems } = report(runs, calls());
  console.log(text);
  const summary = process.env['ARCA_EVAL_REPORT'];
  if (summary !== undefined && summary !== '') appendFileSync(summary, `${text}\n`);
  expect(problems).toEqual([]);
});
