/**
 * The independent check evaluation (ADR-0027): every case through the check's own path, with the
 * Claude adapter, recorded page snapshots behind a fake fetcher that keeps the real fetcher's host
 * rule, and the checks in code. A run passes when no known-wrong or adversarial version comes out
 * checked and at least `minCorrectChecked` correct ones do. The report prints each item's status,
 * so a person can read what an admin would see, and what a check costs.
 */
import { appendFileSync } from 'node:fs';
import type { LogEntry, Logger } from '@arca/telemetry';
import { expect, it } from 'vitest';
import { readAnthropicApiKey } from '../../../src/config.js';
import { claudeRuleChecker } from '../../../src/knowledge/check/claude-checker.js';
import { ruleCheckModel } from '../../../src/knowledge/check/model.js';
import { ruleCheckPromptVersion } from '../../../src/knowledge/check/prompt.js';
import { createVersionCheck } from '../../../src/knowledge/check/run.js';
import { type CheckReport, memoryCheckReportStore } from '../../../src/knowledge/check/store.js';
import { createCheckSubjects } from '../../../src/knowledge/versions.js';
import { maxCallsPerRun, withCallLimit } from './call-limit.js';
import { type CheckCase, checkCases } from './cases.js';
import { caseCatalog, snapshotFetcher } from './harness.js';

const concurrency = 3;

/** Of the four correct cases, at least this many come out checked (ADR-0027 leaves the bar here). */
const minCorrectChecked = 3;

/** At most this many cases may get no answer from the vendor before the run says too little. */
const maxFailures = 1;

/** Claude Sonnet 5.5's list prices in US dollars per million tokens, read 2026-11-07. */
const dollarsPerMillion = { input: 2, output: 10 };

interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** A logger that keeps the call metadata the check logs, never more. */
function usageLogger(usage: Usage): Logger {
  const record = ({ model, inputTokens, outputTokens }: LogEntry) => {
    if (model === undefined) return;
    usage.calls += 1;
    usage.inputTokens += Number(inputTokens ?? 0);
    usage.outputTokens += Number(outputTokens ?? 0);
  };
  return { info: record, error: () => undefined };
}

interface CaseRun {
  readonly evalCase: CheckCase;
  readonly report: CheckReport;
}

async function runCase(
  evalCase: CheckCase,
  checker: ReturnType<typeof withCallLimit>['checker'],
  usage: Usage,
): Promise<CaseRun> {
  const store = memoryCheckReportStore();
  const check = createVersionCheck({
    subject: createCheckSubjects(caseCatalog(evalCase)),
    guide: () => evalCase.guide,
    fetcher: snapshotFetcher(evalCase.snapshots),
    checker: { checker, model: ruleCheckModel, promptVersion: ruleCheckPromptVersion },
    store,
    logger: usageLogger(usage),
    now: () => performance.now(),
  });
  const { routeId, number } = evalCase.entry.version;
  await check(`eval-${evalCase.id}`, routeId, number);
  const [report] = store.rows;
  if (report === undefined) throw new Error(`${evalCase.id} stored no report`);
  return { evalCase, report };
}

const dollars = (usage: Usage) =>
  (usage.inputTokens * dollarsPerMillion.input + usage.outputTokens * dollarsPerMillion.output) /
  1_000_000;

/** Model text as plain text in the public job summary: no backticks, no line breaks. */
const plain = (text: string | null) => (text ?? '').replace(/[`\n\r|]/gu, ' ');

function report(runs: readonly CaseRun[], usage: Usage, calls: number) {
  const problems: string[] = [];
  const failed = runs.filter(({ report: { failure } }) => failure !== null);
  if (failed.length > maxFailures) {
    problems.push(`${String(failed.length)} cases got no answer (at most ${String(maxFailures)})`);
  }
  for (const {
    evalCase,
    report: { clean },
  } of runs) {
    if (evalCase.kind !== 'correct' && clean) problems.push(`${evalCase.id} came out checked`);
  }
  const correct = runs.filter(({ evalCase }) => evalCase.kind === 'correct');
  const correctChecked = correct.filter(({ report: { clean } }) => clean).length;
  if (correctChecked < minCorrectChecked) {
    problems.push(
      `${String(correctChecked)} of ${String(correct.length)} correct versions came out checked (at least ${String(minCorrectChecked)})`,
    );
  }
  const checks = runs.length;
  const lines = [
    '## Independent check evaluation',
    '',
    `Model \`${ruleCheckModel}\`, prompt \`${ruleCheckPromptVersion}\`, ${String(checks)} cases.`,
    problems.length === 0 ? '**Passed.**' : `**Failed:** ${problems.join('; ')}.`,
    '',
    `Correct versions checked: ${String(correctChecked)} of ${String(correct.length)}.`,
    `Tokens: ${String(usage.inputTokens)} in, ${String(usage.outputTokens)} out over ${String(usage.calls)} calls; about US$${(dollars(usage) / checks).toFixed(4)} a check, US$${dollars(usage).toFixed(4)} the run.`,
    '',
  ];
  for (const { evalCase, report: row } of runs) {
    const verdict = row.clean ? 'checked' : 'flagged';
    const failure = row.failure === null ? '' : `, no answer: \`${row.failure}\``;
    lines.push(
      `### ${evalCase.id} (${evalCase.kind}): ${verdict}${failure}`,
      '',
      evalCase.about,
      '',
    );
    if (evalCase.wrongItem !== undefined) {
      const target = row.items.find(({ key }) => key === evalCase.wrongItem);
      lines.push(`Wrong item \`${evalCase.wrongItem}\`: ${target?.status ?? 'missing'}.`, '');
    }
    lines.push('| Item | Status | Reason | Note |', '| --- | --- | --- | --- |');
    for (const item of row.items) {
      lines.push(
        `| \`${item.key}\` | ${item.status} | ${item.reason ?? ''} | ${plain(item.note)} |`,
      );
    }
    const unread = row.fetchLog.filter(({ outcome }) => outcome !== 'read');
    if (unread.length > 0) {
      lines.push('', `Not read: ${unread.map(({ outcome }) => outcome).join(', ')}.`);
    }
    lines.push('');
  }
  lines.push(`Model calls: ${String(calls)} of at most ${String(maxCallsPerRun)}.`);
  return { text: lines.join('\n'), problems };
}

it('flags every wrong and adversarial version and checks most correct ones', async () => {
  const apiKey = readAnthropicApiKey();
  if (apiKey === undefined) {
    throw new Error('Set ANTHROPIC_API_KEY to run the independent check evaluation');
  }
  const { checker, calls } = withCallLimit(claudeRuleChecker({ apiKey }));
  const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const runs: CaseRun[] = [];
  const queue = [...checkCases.entries()];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        const [index, evalCase] = item;
        runs[index] = await runCase(evalCase, checker, usage);
      }
    }),
  );
  const { text, problems } = report(runs, usage, calls());
  console.log(text);
  const summary = process.env['ARCA_EVAL_REPORT'];
  if (summary !== undefined && summary !== '') appendFileSync(summary, `${text}\n`);
  expect(problems).toEqual([]);
});
