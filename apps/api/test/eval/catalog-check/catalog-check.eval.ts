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
import { noUsage, plain, usageLogger, withoutReason } from '../check-report.js';
import { withCallLimit } from '../independent-check/call-limit.js';
import { newestOfEachRoute } from '../newest-versions.js';

const concurrency = 3;

/**
 * The most model calls one run may make: a check and its one retry for each route, and a pick of
 * passages for each long page, with room for a catalog that grows. With the check's own caps on
 * what a call reads and writes, this bounds a run to a few dollars.
 */
const maxCallsPerRun = 200;

/**
 * No check starts after this long, so even one that then takes its longest, about 13 minutes,
 * ends inside the test's time limit and the report is written; the versions left are reported
 * as not run.
 */
const startWithinMs = 20 * 60_000;

interface Version {
  readonly routeId: string;
  readonly number: number;
}

/** The newest version of each route, by route. */
async function newestVersions(): Promise<Version[]> {
  const versions = createKnowledgeVersions({
    states: () => Promise.resolve(new Map()),
    // The listing wants a date for the state it shows; which version is newest does not use it.
    today: () => parseCalendarDate(new Date().toISOString().slice(0, 10)),
  });
  return newestOfEachRoute(await versions.list()).sort((left, right) =>
    left.routeId.localeCompare(right.routeId),
  );
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
    `Matches resting on several quotes: ${String(items.filter(({ status, quotes }) => status === 'matches' && quotes.length > 1).length)}.`,
    `Why not checked: ${tally(reasons)}.`,
    `Left unchecked by the model with no reason: ${String(withoutReason(items).length)}.`,
    `Pages: ${tally(outcomes)}; read through a machine-readable address: ${String(reports.flatMap((report) => report.fetchLog).filter(({ machineReadableUrl }) => machineReadableUrl !== null).length)}.`,
    `Model calls: ${String(calls)} of at most ${String(maxCallsPerRun)}; about US$${dollars.toFixed(2)} the run.`,
    '',
  ];
  for (const { version, report } of runs) {
    const id = `${version.routeId}/${String(version.number)}`;
    if (report === undefined) {
      lines.push(`### ${id}: not run`, '');
      continue;
    }
    const matches = report.items.filter(({ status }) => status === 'matches').length;
    const failure = report.failure === null ? '' : `, no answer: \`${report.failure}\``;
    lines.push(
      `### ${id}: ${String(matches)} of ${String(report.items.length)} match${failure}`,
      '',
      '| Item | Status | Quotes | Reason | Note |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const item of report.items) {
      lines.push(
        `| \`${item.key}\` | ${item.status} | ${String(item.quotes.length)} | ${item.reason ?? ''} | ${plain(item.note)} |`,
      );
    }
    const problems = report.fetchLog.filter(({ outcome, cut }) => outcome !== 'read' || cut);
    if (problems.length > 0) {
      lines.push('', 'Pages not read whole:', '');
      for (const { url, machineReadableUrl, outcome, status, cut } of problems) {
        const how = outcome === 'read' && cut ? 'read, cut' : outcome;
        const through = machineReadableUrl === null ? '' : ` through ${plain(machineReadableUrl)}`;
        lines.push(
          `- ${how}${status === null ? '' : ` (${String(status)})`}: ${plain(url)}${through}`,
        );
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

it('checks the newest version of every bundled route against its live official pages', async () => {
  const apiKey = readAnthropicApiKey();
  if (apiKey === undefined) throw new Error('Set ANTHROPIC_API_KEY to run the catalog check');
  const { checker, locator, calls } = withCallLimit(
    claudeRuleChecker({ apiKey }),
    claudePassageLocator({ apiKey }),
    maxCallsPerRun,
  );
  const usage = noUsage();
  const store = memoryCheckReportStore();
  const check = createVersionCheck({
    subject: createCheckSubjects(),
    guide: countryGuide,
    fetcher: httpsSourceFetcher(),
    checker: { checker, model: ruleCheckModel, promptVersion: ruleCheckPromptVersion },
    locator,
    store,
    logger: usageLogger(usage),
    now: () => performance.now(),
  });

  const versions = await newestVersions();
  const queue = [...versions];
  const started = performance.now();
  const next = () => (performance.now() - started < startWithinMs ? queue.shift() : undefined);
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let version = next(); version !== undefined; version = next()) {
        const { routeId, number } = version;
        await check(`catalog-${routeId}-${String(number)}`, routeId, number);
      }
    }),
  );
  const runs = versions.map((version) => ({
    version,
    report: store.rows.find(
      ({ routeId, number }) => routeId === version.routeId && number === version.number,
    ),
  }));
  const text = summary(runs, calls(), usage.dollars);
  console.log(text);
  const file = process.env['ARCA_EVAL_REPORT'];
  if (file !== undefined && file !== '') appendFileSync(file, `${text}\n`);
  // The check stores a report for every version it runs, so a run with fewer did not finish.
  expect(runs.filter(({ report }) => report === undefined)).toEqual([]);
});
