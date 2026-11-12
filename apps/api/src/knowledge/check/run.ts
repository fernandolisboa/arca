import {
  type CatalogEntry,
  type CheckAnswer,
  type CheckItem,
  type CheckProgressEvent,
  type CheckedItem,
  type Passage,
  type Pin,
  type ReadPage,
  asDataText,
  checkCalls,
  checkItems,
  excerptBudgets,
  excerptPassages,
  excerptText,
  addressPages,
  machineReadableUrls,
  maxPassagesPerItem,
  noGuide,
  officialSources,
  openingExcerpt,
  pageLanguages,
  pageOutline,
  provisionPassages,
  reportClean,
  sentWhole,
  splitPassages,
  verifyAnswers,
  withinTextBudget,
} from '@arca/domain';
import type { CountryGuideEntry } from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import { type ModelReply, loggedModelCall, parsedWithOneRetry } from '../../ai/model-call.js';
import { guideContent } from '../version-content.js';
import { addressesAsRead } from './answer-text.js';
import { parseCheckAnswer, parseCheckAnswerEntry } from './answer.js';
import {
  type RuleCheckRequest,
  type RuleCheckerChoice,
  RuleCheckerError,
  type RuleCheckerFailure,
} from './checker.js';
import { type FetchOutcome, type SourceFetcher, fetchLimits, textDigest } from './fetcher.js';
import type { PageCopies } from './page-copies.js';
import {
  type PassageLocateRequest,
  type PassageLocator,
  PassageLocatorError,
  parsePassageLocation,
} from './locator.js';
import type { CheckProgressStore } from './progress.js';
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
  /** Copies of cited pages attached to correction requests, read where a page cannot be. */
  readonly copies: PageCopies;
  readonly checker: RuleCheckerChoice;
  /** Picks the passages of each long page that the checker reads. */
  readonly locator: PassageLocator;
  readonly store: CheckReportStore;
  /** Where the run says how far it got, for an admin watching it. */
  readonly progress: CheckProgressStore;
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

/** The most characters of item keys a `comparing` event names, within a progress row's size. */
const maxNamedKeysLength = 2_000;

/** The items that cite a page. */
const itemsCiting = (items: readonly CheckItem[], url: string) =>
  items.filter(({ urls }) => urls.includes(url));

interface FetchedPage {
  /** The cited URL, which the model, the quotes and the panel name. */
  readonly url: string;
  /** The machine-readable address read in its place, or null when the page itself was read. */
  readonly machineReadableUrl: string | null;
  /** Whether the text is a copy attached to a correction request, read since the page failed. */
  readonly fromCopy: boolean;
  readonly read: FetchOutcome;
  /** The final status of the page's own fetch, also when a copy was read in its place. */
  readonly status: number | null;
  readonly durationMs: number;
}

type Recorder = (event: CheckProgressEvent) => Promise<void>;

/** What a model call used, as its reply reports it, for the check's cost. */
const usageEvent = (reply: ModelReply): CheckProgressEvent => ({
  kind: 'usage',
  model: reply.model,
  inputTokens: reply.inputTokens ?? null,
  outputTokens: reply.outputTokens ?? null,
  cacheReadTokens: reply.cacheReadTokens ?? null,
  cacheWriteTokens: reply.cacheWriteTokens ?? null,
});

/** The most passages found by a provision's number that go ahead of the locator's picks. */
const maxProvisionPicks = 3;

/** A long page as it is sent, and whether passages were picked for it. */
interface Excerpt {
  readonly page: ReadPage;
  readonly picked: boolean;
}

/** A long page split into passages, and the passages picked for each item key. */
interface Picks {
  readonly passages: readonly Passage[];
  readonly picks: ReadonlyMap<string, readonly number[]> | undefined;
}

/** What one checker call found, and the page text it sent. */
interface Comparison {
  readonly checked: readonly CheckedItem[];
  readonly sent: readonly ReadPage[];
  readonly failure: RuleCheckerFailure | null;
  /** Whether a long page went as its opening because no passage was picked for its items. */
  readonly unpicked: boolean;
}

/**
 * The pages of a machine-readable address read in order and joined into one text, within the
 * per-page text cap, as one long law an official API serves in pages; the first page that fails
 * fails the whole, so no item is checked on part of a law.
 */
async function fetchPages(
  fetcher: SourceFetcher,
  pages: readonly string[],
  hosts: readonly string[],
): Promise<FetchOutcome> {
  if (pages.length === 0) return { ok: false, failure: 'no_text', status: null, chain: [] };
  const texts: string[] = [];
  const chain: string[] = [];
  let status = 0;
  let cut = false;
  let length = 0;
  for (const page of pages) {
    if (length >= fetchLimits.maxTextLength) {
      cut = true;
      break;
    }
    const read = await fetcher.fetch(page, hosts);
    chain.push(...read.chain);
    if (!read.ok) return { ...read, chain };
    if (texts.length === 0) status = read.status;
    texts.push(read.text);
    cut ||= read.cut;
    length += read.text.length + 1;
  }
  const text = texts.join('\n');
  return {
    ok: true,
    status,
    text: text.slice(0, fetchLimits.maxTextLength),
    cut: cut || text.length > fetchLimits.maxTextLength,
    chain,
  };
}

/**
 * The text sent for each page across every call, for the fetch log: one call's text as sent, or
 * the texts of several calls joined in call order; cut when any call cut it.
 */
function sentTexts(sent: readonly ReadPage[]): Map<string, ReadPage> {
  const byUrl = new Map<string, ReadPage>();
  for (const page of sent) {
    const before = byUrl.get(page.url);
    byUrl.set(
      page.url,
      before === undefined
        ? page
        : {
            ...before,
            text: [before.text, page.text].filter((text) => text !== '').join('\n'),
            cut: before.cut || page.cut,
          },
    );
  }
  return byUrl;
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
function sourceTitlesAt(url: string, entry: CatalogEntry): string[] {
  return [
    ...new Set(
      officialSources(entry)
        .filter((source) => source.url === url)
        .map(({ title }) => title),
    ),
  ];
}

/** The report's fetch log: each page's outcome, and the digest of the text sent for it. */
function fetchLogOf(
  fetched: readonly FetchedPage[],
  sent: ReadonlyMap<string, ReadPage>,
): FetchLogEntry[] {
  return fetched.map(({ url, machineReadableUrl, fromCopy, read, status, durationMs }) => {
    const page = sent.get(url);
    return {
      url,
      machineReadableUrl,
      fromCopy,
      outcome: read.ok ? 'read' : read.failure,
      status,
      durationMs,
      sha256: page === undefined ? null : textDigest(page.text),
      cut: page?.cut ?? false,
    };
  });
}

/**
 * Fetches each cited page, or the machine-readable address its sources name in its place, has the
 * locator pick the passages of each long one, asks the checker about every item, checks its answer
 * in code and stores the report keyed by its start. Every failure becomes a fixed code in the
 * report: a page not read leaves its items could not be checked, a failed model call leaves them
 * all so, a long page no passage was picked for is sent cut, and each makes the report
 * short-lived. As it goes it records how far it got, in counts, cited URLs and fixed codes. Page
 * text and model output never reach a log line or a progress event.
 */
export function createVersionCheck({
  subject: subjectOf,
  guide: guideOf,
  fetcher,
  copies,
  checker: { checker, model, promptVersion },
  locator,
  store,
  progress,
  logger,
  now,
}: VersionCheckSettings): VersionCheck {
  /**
   * Records a start's events in order. Progress is only for watching: a write that fails is
   * logged by a fixed code and the check carries on.
   */
  const recorderFor = (startId: string): Recorder => {
    let sequence = 0;
    return async (event) => {
      try {
        await progress.record(startId, sequence++, event);
      } catch {
        logger.error({ route, errorCode: 'check_progress_unwritten' });
      }
    };
  };

  /** The cited pages a check reads, each with its hosts; items citing any further page go unread. */
  const citedPages = (items: readonly CheckItem[], subject: CheckSubject) =>
    [...hostsByUrl(items, subject)].slice(0, maxFetchedPages);

  const fetchCited = async (
    cited: readonly (readonly [string, readonly string[]])[],
    subject: CheckSubject,
    record: Recorder,
  ): Promise<FetchedPage[]> => {
    const fetched: FetchedPage[] = [];
    const addresses = machineReadableUrls(subject.entry);
    // Sources that cite parts of one law often name the same address; it is read once.
    const readAddresses = new Map<string, Promise<FetchOutcome>>();
    const readAddress = (address: string, hosts: readonly string[]) => {
      const key = JSON.stringify([address, hosts]);
      const known = readAddresses.get(key);
      if (known !== undefined) return known;
      const reading = fetchPages(fetcher, addressPages(address), hosts);
      readAddresses.set(key, reading);
      return reading;
    };
    for (const [url, hosts] of cited) {
      await record({ kind: 'page', url, outcome: 'reading', status: null });
      // A machine-readable address is read in place of its page, on the same hosts; when it
      // fails, the page is not tried, so its items could not be checked, with the reason.
      const machineReadableUrl = addresses.get(url) ?? null;
      const started = now();
      const live =
        machineReadableUrl === null
          ? await fetcher.fetch(url, hosts)
          : await readAddress(machineReadableUrl, hosts);
      // Official sites fail often and the report keeps each failure, so the log line is a code.
      if (!live.ok) logger.info({ route, errorCode: `check_fetch_${live.failure}` });
      // A page the check cannot read is read from the copy an owner-list admin attached, if any;
      // the log then names no address, since the text came from neither.
      const copy = live.ok
        ? undefined
        : await copies.read(url).catch(() => {
            logger.error({ route, errorCode: 'check_copy_failed' });
            return undefined;
          });
      const read: FetchOutcome =
        copy === undefined ? live : { ok: true, status: live.status ?? 0, ...copy, chain: [url] };
      await record({
        kind: 'page',
        url,
        outcome: read.ok ? 'read' : read.failure,
        status: live.status,
      });
      fetched.push({
        url,
        machineReadableUrl: copy === undefined ? machineReadableUrl : null,
        fromCopy: copy !== undefined,
        read,
        status: live.status,
        durationMs: Math.max(0, Math.round(now() - started)),
      });
    }
    return fetched;
  };

  const locate = async (
    request: PassageLocateRequest,
    record: Recorder,
  ): Promise<ReadonlyMap<string, readonly number[]> | undefined> => {
    try {
      const answered = await loggedModelCall(
        () => locator.locate(request),
        { route, logger, now },
        (error) =>
          error instanceof PassageLocatorError
            ? new PassageLocatorError(error.code)
            : new PassageLocatorError('locate_failed'),
      );
      await record(usageEvent(answered));
      const picks = parsePassageLocation(answered.reply);
      if (picks === undefined) logger.error({ route, errorCode: 'locate_unparsable' });
      return picks;
    } catch {
      return undefined;
    }
  };

  /**
   * The passages of a long page picked for each item that cites it, by item key: first those that
   * head a provision its source titles name (ADR-0027), then those the locator picked. Undefined
   * when neither found any. The locator is asked once per page with every citing item, whatever
   * calls the items are later compared in.
   */
  const pick = async (
    page: ReadPage,
    items: readonly CheckItem[],
    entry: CatalogEntry,
    askLocator: boolean,
    record: Recorder,
  ): Promise<Picks> => {
    const passages = splitPassages(page.text);
    const citing = itemsCiting(items, page.url);
    const located = askLocator
      ? await locate(
          {
            items: citing.map(({ key, kind, title }) => ({ key, kind, title })),
            sourceTitles: sourceTitlesAt(page.url, entry),
            outline: pageOutline(page.text, passages),
          },
          record,
        )
      : undefined;
    const picks = new Map<string, readonly number[]>();
    for (const { key, citations } of citing) {
      const titles = citations.filter(({ url }) => url === page.url).map(({ title }) => title);
      const provisions = provisionPassages(page.text, passages, titles);
      const merged = [
        ...new Set([
          ...provisions.slice(0, maxProvisionPicks),
          ...(located?.get(key) ?? []),
          ...provisions.slice(maxProvisionPicks),
        ]),
      ];
      if (merged.length > 0) picks.set(key, merged);
    }
    return { passages, picks: picks.size > 0 ? picks : undefined };
  };

  /**
   * A long page as the passages picked for the items of one call that cite it, within `budget`.
   * When none was picked, because the locator was not asked, failed, named no passage of the page
   * for these items, or the budget holds none of their picks, the page goes as its opening marked
   * cut, so no match counts on it.
   */
  const excerptOf = (
    page: ReadPage,
    { passages, picks }: Picks,
    items: readonly CheckItem[],
    budget: number,
  ): Excerpt => {
    const ranked = itemsCiting(items, page.url).map(({ key }) =>
      (picks?.get(key) ?? []).filter((at) => at < passages.length).slice(0, maxPassagesPerItem),
    );
    const picked = new Set(ranked.flat());
    const chosen = picked.size > 0 ? excerptPassages(passages, ranked, budget) : [];
    if (!chosen.some((index) => picked.has(index))) {
      const text = openingExcerpt(page.text, budget);
      return { page: { ...page, text, cut: true, excerpt: true }, picked: false };
    }
    const text = excerptText(page.text, passages, chosen);
    return { page: { ...page, text, excerpt: true }, picked: true };
  };

  /**
   * Records each answer entry the checker hands on, verified as the report will verify it: key and
   * status only. A key no item has is skipped, and a key answered twice in one call could not be
   * checked, as in the report, and is recorded so once whatever the model repeats. A call records
   * at most one event per item, so what a model writes cannot crowd the start's other events out.
   * Each call starts afresh.
   */
  const itemRecorder = (
    items: readonly CheckItem[],
    pages: ReadonlyMap<string, ReadPage>,
    languages: readonly string[],
    record: Recorder,
    written: Promise<void>[],
  ) => {
    const byKey = new Map(items.map((item) => [item.key, item]));
    const answered = new Set<string>();
    const repeated = new Set<string>();
    let recorded = 0;
    return (entry: unknown) => {
      const answer = parseCheckAnswerEntry(entry);
      const item = answer === undefined ? undefined : byKey.get(answer.key);
      if (answer === undefined || item === undefined) return;
      if (repeated.has(item.key) || recorded >= items.length) return;
      recorded += 1;
      const [verified] = answered.has(item.key)
        ? []
        : verifyAnswers([item], [answer], pages, languages);
      (answered.has(item.key) ? repeated : answered).add(item.key);
      written.push(
        record({ kind: 'item', key: item.key, status: verified?.status ?? 'could_not_check' }),
      );
    };
  };

  const ask = async (
    request: RuleCheckRequest,
    record: Recorder,
    onCall: () => (entry: unknown) => void,
  ): Promise<readonly CheckAnswer[]> =>
    parsedWithOneRetry(
      async () => {
        const onEntry = onCall();
        const answered = await loggedModelCall(
          () => checker.check(request, onEntry),
          { route, logger, now },
          (error) =>
            error instanceof RuleCheckerError
              ? new RuleCheckerError(error.code)
              : new RuleCheckerError('check_failed'),
        );
        await record(usageEvent(answered));
        return answered.reply;
      },
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

  /**
   * One checker call: the items given, with only the pages they cite. Short pages go whole; the
   * long ones share what is left of the budget, as excerpts of their items' picks, by how many of
   * the call's items cite each. The answers are checked in code against the text this call sent.
   * With several calls, each names its items as it begins, so a retry clears only its own.
   */
  const compare = async (
    items: readonly CheckItem[],
    readPages: readonly ReadPage[],
    picks: ReadonlyMap<string, Picks>,
    namesItems: boolean,
    languages: readonly string[],
    subject: CheckSubject,
    guide: CountryGuideEntry | undefined,
    record: Recorder,
  ): Promise<Comparison> => {
    const cited = readPages.filter(({ url }) => itemsCiting(items, url).length > 0);
    const budgets = excerptBudgets(
      cited.map(({ url, text }) => ({ text, citing: itemsCiting(items, url).length })),
    );
    let unpicked = false;
    const shaped = cited.map((page, index) => {
      const picked = picks.get(page.url);
      if (picked === undefined) return page;
      const excerpt = excerptOf(page, picked, items, budgets[index] ?? 0);
      if (!excerpt.picked) unpicked = true;
      return excerpt.page;
    });
    // The text sent, framed as data and within the budget, is what quotes are checked against.
    const budgeted = withinTextBudget(shaped);
    const pages = new Map<string, ReadPage>(budgeted.map((page) => [page.url, page]));
    const sent = budgeted.filter(({ text }) => text !== '');
    let answers: readonly CheckAnswer[] = [];
    let failure: RuleCheckerFailure | null = null;
    // With no page text nothing could match, so no model call is paid for.
    if (sent.length > 0) {
      const keys = items.map(({ key }) => key);
      // Keys too long for a progress row go unnamed, so a retry clears every item on screen.
      const comparing: CheckProgressEvent =
        namesItems && JSON.stringify(keys).length <= maxNamedKeysLength
          ? { kind: 'comparing', keys }
          : { kind: 'comparing' };
      await record(comparing);
      const written: Promise<void>[] = [];
      let calls = 0;
      try {
        answers = await ask(
          {
            version: subject.content,
            items: items.map(({ key, kind, title, urls }) => ({ key, kind, title, urls })),
            pages: sent.map(({ url, text, excerpt }) => ({ url, text, excerpt: excerpt === true })),
            guide: guide === undefined ? null : guideContent(guide.guide),
          },
          record,
          // A retry records the comparison again, so the screen drops the first call's answers.
          () => {
            if (calls++ > 0) written.push(record(comparing));
            return itemRecorder(items, pages, languages, record, written);
          },
        );
      } catch (error) {
        failure = error instanceof RuleCheckerError ? error.code : 'check_failed';
      }
      await Promise.all(written);
    }
    return {
      checked: verifyAnswers(items, answers, pages, languages),
      sent: budgeted,
      failure,
      unpicked,
    };
  };

  const check = async (
    startId: string,
    routeId: string,
    number: number,
    subject: CheckSubject,
    record: Recorder,
  ): Promise<void> => {
    const items = checkItems(subject.entry);
    const guide = guideOf(subject.entry.version.country);
    const cited = citedPages(items, subject);
    await record({ kind: 'started', items: items.length, pages: cited.length });
    const fetched = await fetchCited(cited, subject, record);
    const readPages: ReadPage[] = fetched.flatMap(({ url, read }) =>
      read.ok
        ? [
            {
              url,
              text: asDataText(read.text),
              cut: read.cut,
              chain: read.chain,
              echoes: addressesAsRead(read.chain).map(asDataText),
            },
          ]
        : [],
    );
    const longPages = readPages.filter(({ text }) => !sentWhole(text));
    const located = Math.min(longPages.length, maxLocatedPages);
    if (located > 0) await record({ kind: 'locating', pages: located });
    const picks = new Map(
      await Promise.all(
        longPages.map(
          async (page, index) =>
            [
              page.url,
              await pick(page, items, subject.entry, index < maxLocatedPages, record),
            ] as const,
        ),
      ),
    );
    const calls = checkCalls(items, readPages);
    const languages = pageLanguages(subject.entry.version.country);
    const compared = await Promise.all(
      calls.map((callItems) =>
        compare(callItems, readPages, picks, calls.length > 1, languages, subject, guide, record),
      ),
    );
    const byKey = new Map(compared.flatMap(({ checked }) => checked.map((c) => [c.key, c])));
    const checked = items.flatMap(({ key }) => byKey.get(key) ?? []);
    const failure = compared.find((call) => call.failure !== null)?.failure ?? null;
    const fetchLog = fetchLogOf(fetched, sentTexts(compared.flatMap(({ sent }) => sent)));
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
        compared.every(({ sent }) => sent.every(({ text }) => text === '')) ||
        compared.some(({ unpicked }) => unpicked) ||
        fetchLog.some((entry) => entry.outcome !== 'read'),
      clean: reportClean(checked, model),
    });
    await record({ kind: 'finished' });
  };

  return async (startId, routeId, number) => {
    const record = recorderFor(startId);
    const subject = subjectOf(routeId, number);
    if (subject === undefined) {
      logger.error({ route, errorCode: 'check_unknown_version' });
      await record({ kind: 'failed', code: 'check_unknown_version' });
      return;
    }
    try {
      await check(startId, routeId, number, subject, record);
    } catch (error) {
      await record({ kind: 'failed', code: 'check_failed' });
      throw error;
    }
  };
}
