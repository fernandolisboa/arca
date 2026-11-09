import {
  type CatalogEntry,
  type CheckAnswer,
  type CheckItem,
  type Pin,
  type ReadPage,
  asDataText,
  checkItems,
  excerptBudget,
  excerptPassages,
  excerptText,
  maxPassagesPerItem,
  noGuide,
  openingExcerpt,
  pageOutline,
  reportClean,
  sentWhole,
  splitPassages,
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
import {
  type PassageLocateRequest,
  type PassageLocator,
  PassageLocatorError,
  parsePassageLocation,
} from './locator.js';
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
  /** Picks the passages of each long page that the checker reads. */
  readonly locator: PassageLocator;
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
 * The most long pages one check has passages picked for, which bounds its fast-model calls and
 * so their cost; any further long page is sent as its opening, cut.
 */
const maxLocatedPages = 10;

interface FetchedPage {
  readonly url: string;
  readonly read: FetchOutcome;
  readonly durationMs: number;
}

/** A long page as it is sent, and whether passages were picked for it. */
interface Excerpt {
  readonly page: ReadPage;
  readonly picked: boolean;
}

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

/** The titles of the official sources, the version's and its country sets', at one URL. */
function sourceTitlesAt(url: string, { version, countrySets }: CatalogEntry): string[] {
  return [
    ...new Set(
      [version, ...countrySets]
        .flatMap(({ sources }) => sources)
        .filter((source) => source.kind === 'official' && source.url === url)
        .map(({ title }) => title),
    ),
  ];
}

/** The report's fetch log: each page's outcome, and the digest of the text sent for it. */
function fetchLogOf(
  fetched: readonly FetchedPage[],
  sent: ReadonlyMap<string, ReadPage>,
): FetchLogEntry[] {
  return fetched.map(({ url, read, durationMs }) => {
    const page = sent.get(url);
    return {
      url,
      outcome: read.ok ? 'read' : read.failure,
      status: read.status,
      durationMs,
      sha256: page === undefined ? null : textDigest(page.text),
      cut: page?.cut ?? false,
    };
  });
}

/**
 * Fetches each cited page, has the locator pick the passages of each long one, asks the checker
 * about every item, checks its answer in code and stores the report keyed by its start. Every
 * failure becomes a fixed code in the report: a page not read leaves its items could not be
 * checked, a failed model call leaves them all so, a long page no passage was picked for is sent
 * cut, and each makes the report short-lived. Page text and model output never reach a
 * log line.
 */
export function createVersionCheck({
  subject: subjectOf,
  guide: guideOf,
  fetcher,
  checker: { checker, model, promptVersion },
  locator,
  store,
  logger,
  now,
}: VersionCheckSettings): VersionCheck {
  const fetchCited = async (
    items: readonly CheckItem[],
    subject: CheckSubject,
  ): Promise<FetchedPage[]> => {
    const fetched: FetchedPage[] = [];
    // The report's fetch log holds at most this many pages; items citing others go unread.
    const cited = [...hostsByUrl(items, subject)].slice(0, maxFetchedPages);
    for (const [url, hosts] of cited) {
      const started = now();
      const read = await fetcher.fetch(url, hosts);
      // Official sites fail often and the report keeps each failure, so the log line is a code.
      if (!read.ok) logger.info({ route, errorCode: `check_fetch_${read.failure}` });
      fetched.push({ url, read, durationMs: Math.max(0, Math.round(now() - started)) });
    }
    return fetched;
  };

  const locate = async (
    request: PassageLocateRequest,
  ): Promise<ReadonlyMap<string, readonly number[]> | undefined> => {
    try {
      const { reply } = await loggedModelCall(
        () => locator.locate(request),
        { route, logger, now },
        (error) =>
          error instanceof PassageLocatorError
            ? new PassageLocatorError(error.code)
            : new PassageLocatorError('locate_failed'),
      );
      const picks = parsePassageLocation(reply);
      if (picks === undefined) logger.error({ route, errorCode: 'locate_unparsable' });
      return picks;
    } catch {
      return undefined;
    }
  };

  /**
   * A long page as the passages picked for the items that cite it, within `budget`. When none
   * was picked, because the locator was not asked, failed, named no passage of the page, or the
   * budget holds none, the page goes as its opening marked cut, so no match counts on it.
   */
  const excerptOf = async (
    page: ReadPage,
    items: readonly CheckItem[],
    entry: CatalogEntry,
    budget: number,
    ask: boolean,
  ): Promise<Excerpt> => {
    const citing = items.filter(({ urls }) => urls.includes(page.url));
    const passages = splitPassages(page.text);
    const picks = ask
      ? await locate({
          items: citing.map(({ key, kind, title }) => ({ key, kind, title })),
          sourceTitles: sourceTitlesAt(page.url, entry),
          outline: pageOutline(page.text, passages),
        })
      : undefined;
    const ranked = citing.map(({ key }) =>
      (picks?.get(key) ?? []).filter((pick) => pick < passages.length).slice(0, maxPassagesPerItem),
    );
    const chosen = ranked.some((ofItem) => ofItem.length > 0)
      ? excerptPassages(passages, ranked, budget)
      : [];
    if (chosen.length === 0) {
      const text = openingExcerpt(page.text, budget);
      return { page: { ...page, text, cut: true, excerpt: true }, picked: false };
    }
    const text = excerptText(page.text, passages, chosen);
    return { page: { ...page, text, excerpt: true }, picked: true };
  };

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
    const fetched = await fetchCited(items, subject);
    const readPages: ReadPage[] = fetched.flatMap(({ url, read }) =>
      read.ok ? [{ url, text: asDataText(read.text), cut: read.cut, chain: read.chain }] : [],
    );
    // Short pages go whole; the long ones share what is left of the budget, as excerpts.
    const budget = excerptBudget(readPages.map(({ text }) => text));
    const longPages = readPages.filter(({ text }) => !sentWhole(text));
    const excerpts = new Map(
      await Promise.all(
        longPages.map(
          async (page, index) =>
            [
              page.url,
              await excerptOf(page, items, subject.entry, budget, index < maxLocatedPages),
            ] as const,
        ),
      ),
    );
    // The text sent, framed as data and within the total budget, is what quotes are checked against.
    const sent = withinTextBudget(readPages.map((page) => excerpts.get(page.url)?.page ?? page));
    const pages = new Map<string, ReadPage>(sent.map((page) => [page.url, page]));
    const fetchLog = fetchLogOf(fetched, pages);

    let answers: readonly CheckAnswer[] = [];
    let failure: RuleCheckerFailure | null = null;
    const pagesToSend = sent
      .filter(({ text }) => text !== '')
      .map(({ url, text, excerpt }) => ({ url, text, excerpt: excerpt === true }));
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
      // A check that sent the model nothing, or could not pick a long page's passages, is
      // short-lived, like one whose fetch failed.
      failed:
        failure !== null ||
        pagesToSend.length === 0 ||
        [...excerpts.values()].some(({ picked }) => !picked) ||
        fetchLog.some((entry) => entry.outcome !== 'read'),
      clean: reportClean(checked, model),
    });
  };
}
