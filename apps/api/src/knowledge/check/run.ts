import {
  type CatalogEntry,
  type CheckAnswer,
  type CheckItem,
  type Pin,
  type ReadPage,
  asDataText,
  checkItems,
  noGuide,
  reportClean,
  verifyAnswers,
  withinTextBudget,
} from '@arca/domain';
import type { CountryGuideEntry } from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import { loggedModelCall, parsedWithOneRetry } from '../../ai/model-call.js';
import { parseCheckAnswer } from './answer.js';
import {
  type RuleCheckRequest,
  type RuleCheckerChoice,
  RuleCheckerError,
  type RuleCheckerFailure,
} from './checker.js';
import { type FetchOutcome, type SourceFetcher, textDigest } from './fetcher.js';
import type { CheckReportStore, FetchLogEntry } from './store.js';

/** What a check reads about one bundled route version. */
export interface CheckSubject {
  readonly entry: CatalogEntry;
  /** The version as the activation view lays it out, without its hash, state or cases. */
  readonly content: string;
  /** The hosts of the pinned lists, or undefined when the catalog lacks one of them. */
  readonly officialHosts: (pins: readonly Pin[]) => readonly string[] | undefined;
}

export interface VersionCheckSettings {
  readonly subject: (routeId: string, number: number) => CheckSubject | undefined;
  readonly guide: (country: string) => CountryGuideEntry | undefined;
  readonly fetcher: SourceFetcher;
  readonly checker: RuleCheckerChoice;
  readonly store: CheckReportStore;
  readonly logger: Logger;
  /** Monotonic milliseconds, for latencies. */
  readonly now: () => number;
}

/** The independent check of one version, run by the workflow step for one start (ADR-0027). */
export type VersionCheck = (startId: string, routeId: string, number: number) => Promise<void>;

const route = 'workflow:check-version';

/** The most pages one check reads, as the report table's fetch log allows. */
const maxFetchedPages = 200;

/**
 * The hosts each cited URL may be read on: those of every item citing it, so a page two items
 * share is held to the narrower of their lists.
 */
function hostsByUrl(items: readonly CheckItem[], subject: CheckSubject): Map<string, string[]> {
  const hosts = new Map<string, string[]>();
  for (const item of items) {
    const allowed = subject.officialHosts(item.officialDomains) ?? [];
    for (const url of item.urls) {
      const before = hosts.get(url);
      hosts.set(
        url,
        before === undefined ? [...allowed] : before.filter((h) => allowed.includes(h)),
      );
    }
  }
  return hosts;
}

/**
 * Fetches each cited page, asks the checker about every item, checks its answer in code and stores
 * the report keyed by its start. Every failure becomes a fixed code in the report: a page not read
 * leaves its items could not be checked, a failed model call leaves them all so, and either makes
 * the report short-lived. Page text and model output never reach a log line.
 */
export function createVersionCheck({
  subject: subjectOf,
  guide: guideOf,
  fetcher,
  checker: { checker, model, promptVersion },
  store,
  logger,
  now,
}: VersionCheckSettings): VersionCheck {
  const ask = async (request: RuleCheckRequest): Promise<readonly CheckAnswer[]> =>
    parsedWithOneRetry(
      async () =>
        (
          await loggedModelCall(
            () => checker.check(request),
            { route, logger, now },
            (error) =>
              error instanceof RuleCheckerError
                ? new RuleCheckerError(error.code)
                : new RuleCheckerError('check_failed'),
          )
        ).reply,
      parseCheckAnswer,
      {
        isUnparsable: (error) =>
          error instanceof RuleCheckerError && error.code === 'check_unparsable',
        unparsable: () => new RuleCheckerError('check_unparsable'),
        onUnparsable: () => {
          logger.error({ route, errorCode: 'check_unparsable' });
        },
      },
    );

  return async (startId, routeId, number) => {
    const subject = subjectOf(routeId, number);
    if (subject === undefined) {
      logger.error({ route, errorCode: 'check_unknown_version' });
      return;
    }
    const items = checkItems(subject.entry);
    const guide = guideOf(subject.entry.version.country);
    const reads: { url: string; read: FetchOutcome; durationMs: number }[] = [];
    // The report's fetch log holds at most this many pages; items citing others go unread.
    const cited = [...hostsByUrl(items, subject)].slice(0, maxFetchedPages);
    for (const [url, hosts] of cited) {
      const started = now();
      const read = await fetcher.fetch(url, hosts);
      // Official sites fail often and the report keeps each failure, so the log line is a code.
      if (!read.ok) logger.info({ route, errorCode: `check_fetch_${read.failure}` });
      reads.push({ url, read, durationMs: Math.max(0, Math.round(now() - started)) });
    }
    // The text sent, framed as data and within the total budget, is what quotes are checked against.
    const sent = withinTextBudget(
      reads.flatMap(({ url, read }) =>
        read.ok ? [{ url, text: asDataText(read.text), cut: read.cut, chain: read.chain }] : [],
      ),
    );
    const pages = new Map<string, ReadPage>(sent.map((page) => [page.url, page]));
    const fetchLog: FetchLogEntry[] = reads.map(({ url, read, durationMs }) => {
      const page = pages.get(url);
      return {
        url,
        outcome: read.ok ? 'read' : read.failure,
        status: read.status,
        durationMs,
        sha256: page === undefined ? null : textDigest(page.text),
        cut: page?.cut ?? false,
      };
    });

    let answers: readonly CheckAnswer[] = [];
    let failure: RuleCheckerFailure | null = null;
    const pagesToSend = sent
      .filter(({ text }) => text !== '')
      .map(({ url, text }) => ({ url, text }));
    // With no page text nothing could match, so no model call is paid for.
    if (pagesToSend.length > 0) {
      try {
        answers = await ask({
          version: subject.content,
          items: items.map(({ key, kind, title, urls }) => ({ key, kind, title, urls })),
          pages: pagesToSend,
          guide: guide === undefined ? null : JSON.stringify(guide.guide),
        });
      } catch (error) {
        failure = error instanceof RuleCheckerError ? error.code : 'check_failed';
      }
    }

    const checked = verifyAnswers(items, answers, pages);
    await store.save({
      startId,
      routeId,
      number,
      contentHash: subject.entry.identity.hash,
      guideHash: guide?.hash ?? noGuide,
      promptVersion,
      model,
      items: checked,
      fetchLog,
      failure,
      // A check that sent the model nothing is short-lived, like one whose fetch failed.
      failed:
        failure !== null ||
        pagesToSend.length === 0 ||
        fetchLog.some((entry) => entry.outcome !== 'read'),
      clean: reportClean(checked, model),
    });
  };
}
