/**
 * The catalog check (ADR-0027): the independent check of the newest version of every bundled
 * route, through the check's own path, with the real fetcher, the Claude adapters and the real
 * country guides. It measures and never fails on what it finds: it reports how many items match,
 * why each of the others could not be checked and which pages could not be read, so a change to
 * the check can be judged on the real rules. It reads live official sites, so two runs may differ.
 */
import { appendFileSync } from 'node:fs';
import { parseCalendarDate } from '@arca/domain';
import { countryGuide } from '@arca/knowledge';
import type { LogEntry, Logger } from '@arca/telemetry';
import { expect, it } from 'vitest';
import { readAnthropicApiKey } from '../../../src/config.js';
import { claudeRuleChecker } from '../../../src/knowledge/check/claude-checker.js';
import { claudePassageLocator } from '../../../src/knowledge/check/claude-locator.js';
import { httpsSourceFetcher } from '../../../src/knowledge/check/fetcher.js';
import { passageLocateModel, ruleCheckModel } from '../../../src/knowledge/check/model.js';
import { ruleCheckPromptVersion } from '../../../src/knowledge/check/prompt.js';
import { createVersionCheck } from '../../../src/knowledge/check/run.js';
import { type CheckReport, memoryCheckReportStore } from '../../../src/knowledge/check/store.js';
import { createCheckSubjects, createKnowledgeVersions } from '../../../src/knowledge/versions.js';
import { callCounter } from '../call-limit.js';

const concurrency = 3;

/**
 * The most model calls one run may make: a check and its one retry for each route, and one pick of
 * passages for each long page, with room for a catalog that grows. With the check's own caps on
 * what a call reads and writes, this bounds a run to a few dollars.
 */
const maxCallsPerRun = 200;

/** US dollars per million tokens, as the independent check evaluation reads them. */
const dollarsPerMillion: Record<string, { input: number; output: number }> = {
  [ruleCheckModel]: { input: 2, output: 10 },
  [passageLocateModel]: { input: 0.1, output: 0.5 },
};

/** Model text as inert text in the public job summary: one line, no Markdown, no markup. */
const plain = (text: string | null) =>
  (text ?? '')
    .replace(/[\n\r]/gu, ' ')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/[\\`*_[\]()!#~|]/gu, '\\$&');

interface Version {
  readonly routeId: string;
  readonly number: number;
}

/** The newest version of each route, which is what an admin is asked to activate. */
async function newestVersions(): Promise<Version[]> {
  const versions = createKnowledgeVersions({
    states: () => Promise.resolve(new Map()),
    today: () => parseCalendarDate('2026-11-09'),
  });
  const newest = new Map<string, Version>();
  for (const { routeId, number } of await versions.list()) {
    const held = newest.get(routeId);
    if (held === undefined || number > held.number) newest.set(routeId, { routeId, number });
  }
  return [...newest.values()].sort((left, right) => left.routeId.localeCompare(right.routeId));
}

interface Run {
  readonly version: Version;
  readonly report: CheckReport | undefined;
}

function summary(runs: readonly Run[], calls: number, dollars: number): string {
  const reports = runs.flatMap(({ report }) => (report === undefined ? [] : [report]));
  const items = reports.flatMap((report) => report.items);
  const count = (status: string) => items.filter((item) => item.status === status).length;
  const reasons = new Map<string, number>();
  for (const { reason } of items) {
    if (reason !== null) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const outcomes = new Map<string, number>();
  for (const { outcome, cut } of reports.flatMap((report) => report.fetchLog)) {
    const key = outcome === 'read' && cut ? 'read, cut' : outcome;
    outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
  }
  const tally = (counts: ReadonlyMap<string, number>) =>
    [...counts]
      .sort(([, left], [, right]) => right - left)
      .map(([key, value]) => `${key} ${String(value)}`)
      .join(', ');
  const lines = [
    '## Catalog check',
    '',
    `Model \`${ruleCheckModel}\`, prompt \`${ruleCheckPromptVersion}\`, passages picked by \`${passageLocateModel}\`, the newest version of ${String(runs.length)} routes.`,
    '',
    `Versions checked: ${String(reports.filter(({ clean }) => clean).length)} of ${String(runs.length)}.`,
    `Items: ${String(count('matches'))} match, ${String(count('differs'))} differ, ${String(count('could_not_check'))} could not be checked, of ${String(items.length)}.`,
    `Why not checked: ${tally(reasons)}.`,
    `Pages: ${tally(outcomes)}.`,
    `Model calls: ${String(calls)} of at most ${String(maxCallsPerRun)}; about US$${dollars.toFixed(2)} the run.`,
    '',
  ];
  for (const { version, report } of runs) {
    const id = `${version.routeId}/${String(version.number)}`;
    if (report === undefined) {
      lines.push(`### ${id}: no report`, '');
      continue;
    }
    const matches = report.items.filter(({ status }) => status === 'matches').length;
    const failure = report.failure === null ? '' : `, no answer: \`${report.failure}\``;
    lines.push(
      `### ${id}: ${String(matches)} of ${String(report.items.length)} match${failure}`,
      '',
      '| Item | Status | Reason | Note |',
      '| --- | --- | --- | --- |',
    );
    for (const item of report.items) {
      lines.push(
        `| \`${item.key}\` | ${item.status} | ${item.reason ?? ''} | ${plain(item.note)} |`,
      );
    }
    const problems = report.fetchLog.filter(({ outcome, cut }) => outcome !== 'read' || cut);
    if (problems.length > 0) {
      lines.push('', 'Pages not read whole:', '');
      for (const { url, outcome, status, cut } of problems) {
        const how = outcome === 'read' && cut ? 'read, cut' : outcome;
        lines.push(`- ${how}${status === null ? '' : ` (${String(status)})`}: ${plain(url)}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

it('checks the newest version of every bundled route against its live official pages', async () => {
  const apiKey = readAnthropicApiKey();
  if (apiKey === undefined) throw new Error('Set ANTHROPIC_API_KEY to run the catalog check');
  const counter = callCounter(maxCallsPerRun);
  const checker = claudeRuleChecker({ apiKey });
  const locator = claudePassageLocator({ apiKey });
  let dollars = 0;
  const logger: Logger = {
    info: ({ model, inputTokens, outputTokens }: LogEntry) => {
      const price = dollarsPerMillion[String(model)];
      if (price === undefined) return;
      dollars +=
        (Number(inputTokens ?? 0) * price.input + Number(outputTokens ?? 0) * price.output) /
        1_000_000;
    },
    error: () => undefined,
  };
  const store = memoryCheckReportStore();
  const check = createVersionCheck({
    subject: createCheckSubjects(),
    guide: countryGuide,
    fetcher: httpsSourceFetcher(),
    checker: {
      checker: {
        check: (request) => {
          counter.take();
          return checker.check(request);
        },
      },
      model: ruleCheckModel,
      promptVersion: ruleCheckPromptVersion,
    },
    locator: {
      locate: (request) => {
        counter.take();
        return locator.locate(request);
      },
    },
    store,
    logger,
    now: () => performance.now(),
  });

  const versions = await newestVersions();
  const queue = [...versions];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        await check(`catalog-${next.routeId}-${String(next.number)}`, next.routeId, next.number);
      }
    }),
  );
  const runs = versions.map((version) => ({
    version,
    report: store.rows.find(
      ({ routeId, number }) => routeId === version.routeId && number === version.number,
    ),
  }));
  const text = summary(runs, counter.calls(), dollars);
  console.log(text);
  const file = process.env['ARCA_EVAL_REPORT'];
  if (file !== undefined && file !== '') appendFileSync(file, `${text}\n`);
  // The check stores a report for every version it knows, so a run with fewer did not finish.
  expect(runs.filter(({ report }) => report === undefined)).toEqual([]);
});
