// What the independent check evaluation reads a case through, shared with its offline test.
import { hostMatches, identityKey, sourceUrls } from '@arca/domain';
import type { RuleData } from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import { answerFormat, answerText } from '../../../src/knowledge/check/answer-text.js';
import type { RuleChecker, RuleCheckerChoice } from '../../../src/knowledge/check/checker.js';
import {
  type FetchOutcome,
  type SourceFetcher,
  answerWithinLimits,
} from '../../../src/knowledge/check/fetcher.js';
import { type PassageLocator, scriptedLocator } from '../../../src/knowledge/check/locator.js';
import { noPageCopies } from '../../../src/knowledge/check/page-copies.js';
import { createVersionCheck } from '../../../src/knowledge/check/run.js';
import {
  type CheckProgressStore,
  memoryCheckProgressStore,
} from '../../../src/knowledge/check/progress.js';
import { type CheckReport, memoryCheckReportStore } from '../../../src/knowledge/check/store.js';
import { createCheckSubjects } from '../../../src/knowledge/versions.js';
import { type CheckCase, type Snapshot, officialHosts } from './cases.js';

/** The rules one case's version is read from, as the activation view reads the stored ones. */
export function caseRules({ entry }: CheckCase): () => Promise<RuleData> {
  const data: RuleData = {
    entries: new Map([[identityKey(entry.identity), entry]]),
    cases: [],
    hosts: Object.fromEntries(
      entry.version.sources.flatMap(sourceUrls).map((url) => [url, new URL(url).hostname]),
    ),
    officialDomains: entry.version.officialDomains
      .filter(({ id }) => id === 'qm')
      .map(({ id, number }) => ({ id, number, hosts: officialHosts })),
    refused: [],
  };
  return () => Promise.resolve(data);
}

const htmlType = 'text/html';

/**
 * A snapshot's text as the real fetcher reads its media type, or undefined for one it does not or
 * for a PDF, whose text only the fetcher's own reading gives.
 */
export function snapshotText({ body, type = htmlType }: Snapshot): string | undefined {
  const format = answerFormat(type);
  return format === undefined || format === 'pdf' || typeof body !== 'string'
    ? undefined
    : answerText(format, body);
}

/**
 * Serves the case's snapshots, with the real fetcher's host rule on every hop and its own reading
 * of each media type within its limits, so a redirect off the pinned hosts is refused as it would
 * be in production.
 */
export function snapshotFetcher(snapshots: ReadonlyMap<string, Snapshot>): SourceFetcher {
  return {
    fetch(url, hosts) {
      const snapshot = snapshots.get(url);
      if (snapshot === undefined) {
        return Promise.resolve({ ok: false, failure: 'network', status: null, chain: [url] });
      }
      const chain = snapshot.chain ?? [url];
      for (const [hop, address] of chain.entries()) {
        if (!hostMatches(new URL(address).hostname, hosts)) {
          return Promise.resolve<FetchOutcome>({
            ok: false,
            failure: hop === 0 ? 'refused_url' : 'redirect_refused',
            status: hop === 0 ? null : 301,
            chain: chain.slice(0, hop + 1),
          });
        }
      }
      const format = answerFormat(snapshot.type ?? htmlType);
      if (format === undefined) {
        return Promise.resolve({ ok: false, failure: 'unsupported_type', status: 200, chain });
      }
      const { body } = snapshot;
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
      const text = () => (typeof body === 'string' ? body : new TextDecoder().decode(body));
      return answerWithinLimits(format, { bytes, text }, AbortSignal.timeout(20_000)).then(
        (read): FetchOutcome =>
          read.ok
            ? { ok: true, status: 200, text: read.text, cut: read.cut, chain }
            : { ok: false, failure: read.failure, status: 200, chain },
      );
    },
  };
}

/** The checker, keeping the page text of each request, so a run can tell what the model read. */
export function recordingPages(checker: RuleChecker) {
  const sent: string[] = [];
  const recording: RuleChecker = {
    check(request, onEntry) {
      sent.push(...request.pages.map(({ text }) => text));
      return checker.check(request, onEntry);
    },
  };
  return { checker: recording, sent: () => sent.join('\n') };
}

const silentLogger: Logger = { info: () => undefined, error: () => undefined };

/** One case through the check's own path, as its workflow step runs it, answering its report. */
export async function checkCase(
  evalCase: CheckCase,
  checker: RuleCheckerChoice,
  logger: Logger = silentLogger,
  locator: PassageLocator = scriptedLocator,
  progress: CheckProgressStore = memoryCheckProgressStore(),
): Promise<CheckReport> {
  const store = memoryCheckReportStore();
  const check = createVersionCheck({
    subject: createCheckSubjects(caseRules(evalCase)),
    guide: () => evalCase.guide,
    fetcher: snapshotFetcher(evalCase.snapshots),
    copies: noPageCopies,
    checker,
    locator,
    store,
    progress,
    logger,
    now: () => performance.now(),
  });
  const { routeId, number } = evalCase.entry.version;
  await check(`eval-${evalCase.id}`, routeId, number);
  const [report] = store.rows;
  if (report === undefined) throw new Error(`${evalCase.id} stored no report`);
  return report;
}
