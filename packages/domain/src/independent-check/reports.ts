/** What a report answers for besides the version: its content, guide, prompt and model. */
export interface ReportKey {
  readonly contentHash: string;
  /** The country guide's content hash, or `none` when the country had no guide. */
  readonly guideHash: string;
  readonly promptVersion: string;
  readonly model: string;
}

/** The guide hash a report records when the version's country has no guide. */
export const noGuide = 'none';

/** What freshness reads of a stored report. Times are milliseconds since the epoch. */
export interface ReportMeta extends ReportKey {
  readonly startId: string;
  readonly checkedAt: number;
  /** A fetch or the model call failed, so the report is retried sooner. */
  readonly failed: boolean;
}

/** A recorded start of a check, live until its report arrives or it dies. */
export interface CheckStart {
  readonly id: string;
  readonly startedAt: number;
}

const minute = 60_000;
const day = 24 * 60 * minute;

/** A report stays current this long, or one day when a fetch or the model failed (ADR-0027). */
export const reportLifetime = 30 * day;
export const failedReportLifetime = day;
/** A start with no report after this long is dead, and the version may be started again. */
export const startLifetime = 30 * minute;
/** Starts allowed in any 24 hours, per environment. */
export const maxStartsPerDay = 20;
export const startWindow = day;

const sameKey = (left: ReportKey, right: ReportKey) =>
  left.contentHash === right.contentHash &&
  left.guideHash === right.guideHash &&
  left.promptVersion === right.promptVersion &&
  left.model === right.model;

/**
 * A version's current report: its newest report for today's content, guide, prompt and model,
 * while it is younger than its lifetime.
 */
export function currentReport<R extends ReportMeta>(
  reports: readonly R[],
  key: ReportKey,
  now: number,
): R | undefined {
  const newest = reports
    .filter((report) => sameKey(report, key))
    .reduce<R | undefined>(
      (best, report) => (best === undefined || report.checkedAt > best.checkedAt ? report : best),
      undefined,
    );
  if (newest === undefined) return undefined;
  const lifetime = newest.failed ? failedReportLifetime : reportLifetime;
  return now - newest.checkedAt < lifetime ? newest : undefined;
}

/** Whether a start is still running: young enough, and no report came from it. */
export function liveStart(
  start: CheckStart,
  reports: readonly Pick<ReportMeta, 'startId'>[],
  now: number,
): boolean {
  return now - start.startedAt < startLifetime && !reports.some((r) => r.startId === start.id);
}

export const listedCheckStatuses = ['checked', 'flagged', 'running', 'stale', 'none'] as const;
export type ListedCheckStatus = (typeof listedCheckStatuses)[number];

/**
 * A version's check status for the list: checked or flagged by its current report, else running
 * while a start is live, else stale when an older report exists, else none.
 */
export function listedCheckStatus(
  reports: readonly (ReportMeta & { readonly clean: boolean })[],
  starts: readonly CheckStart[],
  key: ReportKey,
  now: number,
): ListedCheckStatus {
  const current = currentReport(reports, key, now);
  if (current !== undefined) return current.clean ? 'checked' : 'flagged';
  if (starts.some((start) => liveStart(start, reports, now))) return 'running';
  return reports.length > 0 ? 'stale' : 'none';
}

/** A version the screen may start a check for, with what its report would answer for. */
export interface StartCandidate {
  readonly routeId: string;
  readonly number: number;
  readonly key: ReportKey;
  readonly reports: readonly ReportMeta[];
  readonly starts: readonly CheckStart[];
}

/**
 * The versions to start now, in the order given: each with no current report and no live start,
 * within what is left of the starts allowed in the last 24 hours.
 */
export function versionsToStart<C extends StartCandidate>(
  candidates: readonly C[],
  startsInWindow: number,
  now: number,
): C[] {
  const left = Math.max(0, maxStartsPerDay - startsInWindow);
  return candidates
    .filter(
      (candidate) =>
        currentReport(candidate.reports, candidate.key, now) === undefined &&
        !candidate.starts.some((start) => liveStart(start, candidate.reports, now)),
    )
    .slice(0, left);
}
