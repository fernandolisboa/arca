// What the independent check evaluation reads a case through, shared with its offline test.
import { hostMatches } from '@arca/domain';
import type { Logger } from '@arca/telemetry';
import type { RuleCheckerChoice } from '../../../src/knowledge/check/checker.js';
import {
  type FetchOutcome,
  type SourceFetcher,
  capText,
} from '../../../src/knowledge/check/fetcher.js';
import { htmlToText } from '../../../src/knowledge/check/html-text.js';
import { type PassageLocator, scriptedLocator } from '../../../src/knowledge/check/locator.js';
import { createVersionCheck } from '../../../src/knowledge/check/run.js';
import { type CheckReport, memoryCheckReportStore } from '../../../src/knowledge/check/store.js';
import { createCheckSubjects } from '../../../src/knowledge/versions.js';
import { type CheckCase, type Snapshot, officialHosts } from './cases.js';

/** The catalog shape the check reads a version through, without importing the display catalog. */
type CaseCatalog = NonNullable<Parameters<typeof createCheckSubjects>[0]>;

/** The catalog one case's version is read through, as the activation view reads the real one. */
export function caseCatalog({ entry }: CheckCase): CaseCatalog {
  return {
    entries: () => [entry],
    comparisons: () => [],
    versions: (routeId) => (routeId === entry.version.routeId ? [entry] : []),
    cases: () => [],
    hostOf: (url) => new URL(url).hostname,
    officialHosts: (pins) => (pins.every(({ id }) => id === 'qm') ? officialHosts : undefined),
  };
}

/**
 * Serves the case's snapshots, with the real fetcher's host rule on every hop and its text cap, so
 * a redirect off the pinned hosts is refused as it would be in production.
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
      return Promise.resolve<FetchOutcome>({
        ok: true,
        status: 200,
        ...capText(htmlToText(snapshot.html)),
        chain,
      });
    },
  };
}

const silentLogger: Logger = { info: () => undefined, error: () => undefined };

/** One case through the check's own path, as its workflow step runs it, answering its report. */
export async function checkCase(
  evalCase: CheckCase,
  checker: RuleCheckerChoice,
  logger: Logger = silentLogger,
  locator: PassageLocator = scriptedLocator,
): Promise<CheckReport> {
  const store = memoryCheckReportStore();
  const check = createVersionCheck({
    subject: createCheckSubjects(caseCatalog(evalCase)),
    guide: () => evalCase.guide,
    fetcher: snapshotFetcher(evalCase.snapshots),
    checker,
    locator,
    store,
    logger,
    now: () => performance.now(),
  });
  const { routeId, number } = evalCase.entry.version;
  await check(`eval-${evalCase.id}`, routeId, number);
  const [report] = store.rows;
  if (report === undefined) throw new Error(`${evalCase.id} stored no report`);
  return report;
}
