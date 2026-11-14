import {
  type CheckItem,
  type CheckProgress,
  type CheckPoints,
  type CheckedItem,
  type ListedCheckStatus,
  type ReportKey,
  type StartShare,
  checkCost,
  checkItems,
  checkProgress,
  currentReport,
  newestReport,
  newestStart,
  listedCheckStatus,
  noGuide,
  reportPoints,
  scriptedCheckerModel,
  usagesOf,
  versionKey,
} from '@arca/domain';
import type { CountryGuideEntry } from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import type { RuleCheckerChoice } from './check/checker.js';
import { checkModelPrices } from './check/prices.js';
import type { CheckProgressStore } from './check/progress.js';
import type { CheckSubject } from './check/run.js';
import type { RecordedStart, CheckStarts } from './check/starts.js';
import type { CheckReport, CheckReportStore, FetchLogEntry } from './check/store.js';
import type { CorrectorFlaggedVersions, KnowledgeVersion } from '@arca/api-contract/routes';
import type { KnowledgeVersions } from './versions.js';

/** A version's current report as the activation screen shows it (ADR-0027). */
export interface ShownReport {
  readonly checkedAt: number;
  readonly clean: boolean;
  readonly scripted: boolean;
  readonly failure: CheckReport['failure'];
  readonly guide: { readonly country: string; readonly number: number } | null;
  readonly items: readonly (CheckedItem &
    Pick<CheckItem, 'kind' | 'title' | 'citations' | 'values'>)[];
  readonly fetchLog: readonly FetchLogEntry[];
}

export type ReportOutcome =
  | {
      readonly ok: true;
      readonly status: ListedCheckStatus;
      readonly report: ShownReport | null;
    }
  | { readonly ok: false; readonly reason: 'not_found' };

export type RequestedCheckOutcome =
  /** `started` is false when the version's live start was answered in place of a new one. */
  | { readonly ok: true; readonly started: boolean }
  | { readonly ok: false; readonly reason: 'not_found' | 'check_not_started' };

/** A check's progress, and whether the scripted checker writes this environment's answers. */
export type ShownProgress = CheckProgress & { readonly scripted: boolean };

export type ProgressOutcome =
  | {
      readonly ok: true;
      readonly progress: ShownProgress | null;
      /** What the version's newest check with a report that did not fail cost, in millionths of a dollar, if priced. */
      readonly lastCostMicroUsd: number | null;
    }
  | { readonly ok: false; readonly reason: 'not_found' };

/** A version's check on the list: its status, and its current report's points if it has one. */
export interface ListedCheck {
  readonly status: ListedCheckStatus;
  readonly points: CheckPoints | null;
}

/** The independent check as the activation screen reaches it (ADR-0027). */
export interface VersionChecks {
  /**
   * Starts a check for every proposed route version that is due and not superseded; answers how
   * many started.
   */
  readonly start: (route?: string) => Promise<number>;
  /**
   * An admin's start of every proposed route version that is due and not superseded, with no daily
   * cap; answers how many started and whether every run began.
   */
  readonly startQueued: () => Promise<{ readonly started: number; readonly began: boolean }>;
  /** An admin's own start of one route version, in any state and whatever its reports say. */
  readonly startOne: (routeId: string, number: number) => Promise<RequestedCheckOutcome>;
  /**
   * How far the version's newest start of the last 24 hours got, or null with none, and what its
   * newest finished check cost.
   */
  readonly progress: (routeId: string, number: number) => Promise<ProgressOutcome>;
  /** Each route version's check status and its current report's points, by `routeId/number`. */
  readonly statuses: () => Promise<ReadonlyMap<string, ListedCheck>>;
  readonly report: (routeId: string, number: number) => Promise<ReportOutcome>;
  /**
   * The open proposals the check flagged, each with its current report's items that did not
   * match, as codes, those with an item that differs first, at most `limit` (ADR-0029).
   */
  readonly flagged: (limit: number) => Promise<CorrectorFlaggedVersions['versions']>;
}

/** A proposed version that no date from today on leaves behind, so it still waits for a decision. */
const openProposal = ({
  state,
  superseded,
}: {
  readonly state: string;
  readonly superseded: boolean;
}) => state === 'proposed' && !superseded;

export interface VersionCheckSettings {
  readonly versions: KnowledgeVersions;
  readonly subject: (routeId: string, number: number) => CheckSubject | undefined;
  readonly guide: (country: string) => CountryGuideEntry | undefined;
  /** What today's reports are stored under. */
  readonly checker: Pick<RuleCheckerChoice, 'model' | 'promptVersion'>;
  readonly reports: CheckReportStore;
  readonly starts: CheckStarts;
  readonly progress: CheckProgressStore;
  /** Starts the workflow of one recorded start, with identifiers only. */
  readonly run: (start: RecordedStart) => Promise<void>;
  readonly logger: Logger;
  /** Wall-clock milliseconds, the clock reports and starts are dated on. */
  readonly now: () => number;
}

/** Rows of one route version. */
const ofVersion =
  (routeId: string, number: number) =>
  <T extends { readonly routeId: string; readonly number: number }>(rows: readonly T[]) =>
    rows.filter((row) => row.routeId === routeId && row.number === number);

export function createVersionChecks({
  versions,
  subject,
  guide,
  checker,
  reports,
  starts,
  progress,
  run,
  logger,
  now,
}: VersionCheckSettings): VersionChecks {
  const keyOf = (hash: string, country: string): ReportKey => ({
    contentHash: hash,
    guideHash: guide(country)?.hash ?? noGuide,
    promptVersion: checker.promptVersion,
    model: checker.model,
  });

  /**
   * Answers whether every run began. A start whose run never begins dies in 30 minutes, and may
   * then be started again.
   */
  const runAll = async (started: readonly RecordedStart[], route: string) => {
    const runs = await Promise.allSettled(started.map((each) => run(each)));
    if (runs.every((outcome) => outcome.status === 'fulfilled')) return true;
    logger.error({ route, errorCode: 'check_not_started' });
    return false;
  };

  const startDue = async (route: string, share: StartShare) => {
    const proposed = (await versions.list()).filter(openProposal);
    const started = await starts.begin(
      proposed.map(({ routeId, number, hash, country }) => ({
        routeId,
        number,
        key: keyOf(hash, country),
      })),
      share,
    );
    return { started: started.length, began: await runAll(started, route) };
  };

  return {
    start: async (route = '/v1/knowledge/checks/start') =>
      (await startDue(route, 'automatic')).started,

    startQueued: () => startDue('/v1/knowledge/checks/start-queued', 'admin'),

    async startOne(routeId, number) {
      if (subject(routeId, number) === undefined) return { ok: false, reason: 'not_found' };
      const requested = await starts.request({ routeId, number });
      if (!requested.began) return { ok: true, started: false };
      return (await runAll([requested.start], '/v1/knowledge/versions/check/start'))
        ? { ok: true, started: true }
        : { ok: false, reason: 'check_not_started' };
    },

    async progress(routeId, number) {
      const found = subject(routeId, number);
      if (found === undefined) return { ok: false, reason: 'not_found' };
      const own = ofVersion(routeId, number);
      const [recent, stored] = await Promise.all([starts.recent(), reports.list()]);
      const newest = newestStart(own(recent));
      // A failed run may have stopped before its model calls, so its cost says little of the next one's.
      const lastReport = newestReport(own(stored).filter(({ failed }) => !failed));
      const [events, lastEvents] = await Promise.all([
        newest === undefined ? [] : progress.list(newest.id),
        lastReport === undefined || lastReport.startId === newest?.id
          ? undefined
          : progress.list(lastReport.startId),
      ]);
      const last =
        lastReport === undefined
          ? null
          : checkCost(usagesOf(lastEvents ?? events), checkModelPrices);
      const lastCostMicroUsd = last?.kind === 'priced' ? last.microUsd : null;
      if (newest === undefined) return { ok: true, progress: null, lastCostMicroUsd };
      const reported = stored.some(({ startId }) => startId === newest.id);
      return {
        ok: true,
        progress: {
          ...checkProgress(
            newest,
            events,
            reported,
            now(),
            checkModelPrices,
            checkItems(found.entry),
          ),
          scripted: checker.model === scriptedCheckerModel,
        },
        lastCostMicroUsd,
      };
    },

    async statuses() {
      const [listed, stored, recent] = await Promise.all([
        versions.list(),
        reports.list(),
        starts.recent(),
      ]);
      const time = now();
      return new Map(
        listed.map(({ routeId, number, hash, country }) => {
          const own = ofVersion(routeId, number);
          const key = keyOf(hash, country);
          const current = currentReport(own(stored), key, time);
          return [
            versionKey({ routeId, number }),
            {
              status: listedCheckStatus(own(stored), own(recent), key, time),
              points: current === undefined ? null : reportPoints(current.counts, current.model),
            },
          ];
        }),
      );
    },

    async flagged(limit) {
      const [listed, stored, recent] = await Promise.all([
        versions.list(),
        reports.list(),
        starts.recent(),
      ]);
      const time = now();
      const found = await Promise.all(
        listed.filter(openProposal).map(async ({ routeId, number, hash, country }) => {
          const own = ofVersion(routeId, number);
          const key = keyOf(hash, country);
          const current = currentReport(own(stored), key, time);
          const entry = subject(routeId, number)?.entry;
          if (
            current === undefined ||
            entry === undefined ||
            listedCheckStatus(own(stored), own(recent), key, time) !== 'flagged'
          ) {
            return [];
          }
          const report = await reports.find(current.startId);
          const known = new Map(checkItems(entry).map((item) => [item.key, item.kind]));
          const items = (report?.items ?? []).flatMap(({ key: itemKey, status, reason }) => {
            const kind = known.get(itemKey);
            return status === 'matches' || kind === undefined
              ? []
              : [{ key: itemKey, kind, status, reason }];
          });
          if (report === undefined || items.length === 0) return [];
          return [{ routeId, number, checkedAt: new Date(report.checkedAt).toISOString(), items }];
        }),
      );
      const differs = (version: { readonly items: readonly { readonly status: string }[] }) =>
        version.items.some(({ status }) => status === 'differs') ? 0 : 1;
      return found
        .flat()
        .sort(
          (one, other) =>
            differs(one) - differs(other) ||
            one.routeId.localeCompare(other.routeId) ||
            one.number - other.number,
        )
        .slice(0, limit);
    },

    async report(routeId, number) {
      const found = subject(routeId, number);
      if (found === undefined) return { ok: false, reason: 'not_found' };
      const { identity, version } = found.entry;
      const key = keyOf(identity.hash, version.country);
      const own = ofVersion(routeId, number);
      const ownReports = own(await reports.list());
      const ownStarts = own(await starts.recent());
      const time = now();
      const status = listedCheckStatus(ownReports, ownStarts, key, time);
      const current = currentReport(ownReports, key, time);
      if (current === undefined) return { ok: true, status, report: null };
      const stored = await reports.find(current.startId);
      if (stored === undefined) {
        // A row the report schema refuses is never shown; the list may still count it until it ages out.
        logger.error({
          route: '/v1/knowledge/versions/check',
          errorCode: 'check_report_unreadable',
        });
        return { ok: true, status: 'stale', report: null };
      }
      const items = new Map(checkItems(found.entry).map((item) => [item.key, item]));
      const countryGuide = guide(version.country);
      return {
        ok: true,
        status,
        report: {
          checkedAt: stored.checkedAt,
          clean: stored.clean,
          scripted: stored.model === scriptedCheckerModel,
          failure: stored.failure,
          guide:
            countryGuide === undefined || stored.guideHash === noGuide
              ? null
              : { country: version.country, number: countryGuide.guide.number },
          items: stored.items.flatMap((item) => {
            const listed = items.get(item.key);
            return listed === undefined
              ? []
              : [
                  {
                    ...item,
                    kind: listed.kind,
                    title: listed.title,
                    citations: listed.citations,
                    values: listed.values,
                  },
                ];
          }),
          fetchLog: stored.fetchLog,
        },
      };
    },
  };
}

/**
 * Every bundled route version with its check status, `none` where no check runs: what the screen
 * lists and what the checked batch decides on, so the two never disagree (ADR-0027).
 */
export async function versionsWithChecks(
  versions: Pick<KnowledgeVersions, 'list'>,
  checks: Pick<VersionChecks, 'statuses'> | undefined,
): Promise<KnowledgeVersion[]> {
  const [listed, statuses] = await Promise.all([
    versions.list(),
    checks?.statuses() ?? new Map<string, ListedCheck>(),
  ]);
  return listed.map((version) => {
    const check = statuses.get(versionKey(version));
    return { ...version, check: check?.status ?? 'none', points: check?.points ?? null };
  });
}
