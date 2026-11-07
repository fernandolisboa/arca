import {
  type CheckItemKind,
  type CheckedItem,
  type ListedCheckStatus,
  type ReportKey,
  checkItems,
  currentReport,
  listedCheckStatus,
  noGuide,
  scriptedCheckerModel,
} from '@arca/domain';
import type { CountryGuideEntry } from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import type { RuleCheckerChoice } from './check/checker.js';
import type { CheckSubject } from './check/run.js';
import type { RecordedStart, CheckStarts } from './check/starts.js';
import type { CheckReport, CheckReportStore, FetchLogEntry } from './check/store.js';
import type { KnowledgeVersions } from './versions.js';

/** A version's current report as the activation screen shows it (ADR-0027). */
export interface ShownReport {
  readonly checkedAt: number;
  readonly clean: boolean;
  readonly scripted: boolean;
  readonly failure: CheckReport['failure'];
  readonly guide: { readonly country: string; readonly number: number } | null;
  readonly items: readonly (CheckedItem & {
    readonly kind: CheckItemKind;
    readonly title: string;
  })[];
  readonly fetchLog: readonly FetchLogEntry[];
}

export type ReportOutcome =
  | {
      readonly ok: true;
      readonly status: ListedCheckStatus;
      readonly report: ShownReport | null;
    }
  | { readonly ok: false; readonly reason: 'not_found' };

/** The independent check as the activation screen reaches it (ADR-0027). */
export interface VersionChecks {
  /** Starts a check for every proposed route version that is due; answers how many started. */
  readonly start: () => Promise<number>;
  /** Each route version's check status, by `routeId/number`. */
  readonly statuses: () => Promise<ReadonlyMap<string, ListedCheckStatus>>;
  readonly report: (routeId: string, number: number) => Promise<ReportOutcome>;
}

export interface VersionCheckSettings {
  readonly versions: KnowledgeVersions;
  readonly subject: (routeId: string, number: number) => CheckSubject | undefined;
  readonly guide: (country: string) => CountryGuideEntry | undefined;
  /** What today's reports are stored under. */
  readonly checker: Pick<RuleCheckerChoice, 'model' | 'promptVersion'>;
  readonly reports: CheckReportStore;
  readonly starts: CheckStarts;
  /** Starts the workflow of one recorded start, with identifiers only. */
  readonly run: (start: RecordedStart) => Promise<void>;
  readonly logger: Logger;
  /** Wall-clock milliseconds, the clock reports and starts are dated on. */
  readonly now: () => number;
}

export const checkStatusKey = (routeId: string, number: number) => `${routeId}/${String(number)}`;

export function createVersionChecks({
  versions,
  subject,
  guide,
  checker,
  reports,
  starts,
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

  return {
    async start() {
      const proposed = (await versions.list()).filter(({ state }) => state === 'proposed');
      const started = await starts.begin(
        proposed.map(({ routeId, number, hash, country }) => ({
          routeId,
          number,
          key: keyOf(hash, country),
        })),
      );
      // A start whose run never begins dies in 30 minutes, and the next screen tries again.
      const runs = await Promise.allSettled(started.map((each) => run(each)));
      if (runs.some((outcome) => outcome.status === 'rejected')) {
        logger.error({ route: '/v1/knowledge/checks/start', errorCode: 'check_not_started' });
      }
      return started.length;
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
          const own = <T extends { routeId: string; number: number }>(rows: readonly T[]) =>
            rows.filter((row) => row.routeId === routeId && row.number === number);
          return [
            checkStatusKey(routeId, number),
            listedCheckStatus(own(stored), own(recent), keyOf(hash, country), time),
          ];
        }),
      );
    },

    async report(routeId, number) {
      const found = subject(routeId, number);
      if (found === undefined) return { ok: false, reason: 'not_found' };
      const { identity, version } = found.entry;
      const key = keyOf(identity.hash, version.country);
      const own = (await reports.list()).filter(
        (row) => row.routeId === routeId && row.number === number,
      );
      const recent = (await starts.recent()).filter(
        (row) => row.routeId === routeId && row.number === number,
      );
      const status = listedCheckStatus(own, recent, key, now());
      const current = currentReport(own, key, now());
      const stored = current === undefined ? undefined : await reports.find(current.startId);
      if (stored === undefined) return { ok: true, status, report: null };
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
              : [{ ...item, kind: listed.kind, title: listed.title }];
          }),
          fetchLog: stored.fetchLog,
        },
      };
    },
  };
}
