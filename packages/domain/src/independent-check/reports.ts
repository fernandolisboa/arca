/** What a report answers for besides the version: its content, guide, prompt and model. */
export interface ReportKey {
  readonly contentHash: string;
  /** The country guide's content hash, or `none` when the country had no guide. */
  readonly guideHash: string;
  readonly promptVersion: string;
  readonly model: string;
}

/** Why a cited page was not read. Fixed codes only: they reach the report and the logs. */
export const fetchFailures = [
  'refused_url',
  'redirect_refused',
  'too_many_redirects',
  'address_refused',
  'lookup_failed',
  'http_status',
  'unsupported_type',
  'no_text',
  'pdf_no_text',
  'pdf_unreadable',
  'too_large',
  'timeout',
  'network',
] as const;
export type FetchFailure = (typeof fetchFailures)[number];
export const fetchOutcomes = ['read', ...fetchFailures] as const;

/** Why the checker gave no answer, so every item of the report could not be checked. */
export const checkFailures = [
  'check_unparsable',
  'check_timeout',
  'check_unavailable',
  'check_failed',
] as const;
export type CheckFailure = (typeof checkFailures)[number];

/** A route version as one string, for maps keyed by version. */
export const versionKey = ({ routeId, number }: { routeId: string; number: number }): string =>
  `${routeId}/${String(number)}`;

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
  /** Its run recorded a failure, so it ends with no report and may be started again. */
  readonly failed?: boolean;
}

const minute = 60_000;
const day = 24 * 60 * minute;

/** A report stays current this long, or one day when a fetch or the model failed (ADR-0027). */
export const reportLifetime = 30 * day;
export const failedReportLifetime = day;
/** A start with no report after this long is dead, and the version may be started again. */
export const startLifetime = 30 * minute;
/** The window the automatic share is counted over. */
export const startWindow = day;
/**
 * Starts the activation screen may use by itself in any 24 hours, per environment, counting every
 * start in the window. A check an admin asks for has no cap.
 */
export const maxAutomaticStartsPerDay = 15;

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
  const newest = newestReport(reports.filter((report) => sameKey(report, key)));
  if (newest === undefined) return undefined;
  const lifetime = newest.failed ? failedReportLifetime : reportLifetime;
  return now - newest.checkedAt < lifetime ? newest : undefined;
}

/** Reports of today's key still within their lifetime: what a version's status rests on. */
function liveReports<R extends ReportMeta>(
  reports: readonly R[],
  key: ReportKey,
  now: number,
): R[] {
  return reports.filter(
    (report) =>
      sameKey(report, key) &&
      now - report.checkedAt < (report.failed ? failedReportLifetime : reportLifetime),
  );
}

/** The report checked last, whatever its key and age. */
export function newestReport<R extends ReportMeta>(reports: readonly R[]): R | undefined {
  return reports.reduce<R | undefined>(
    (newest, report) =>
      newest === undefined || report.checkedAt > newest.checkedAt ? report : newest,
    undefined,
  );
}

/** The newest of some starts. */
export function newestStart<S extends CheckStart>(starts: readonly S[]): S | undefined {
  return starts.reduce<S | undefined>(
    (newest, start) =>
      newest === undefined || start.startedAt > newest.startedAt ? start : newest,
    undefined,
  );
}

/** Whether a start is still running: young enough, not failed, and no report came from it. */
export function liveStart(
  start: CheckStart,
  reports: readonly Pick<ReportMeta, 'startId'>[],
  now: number,
): boolean {
  return (
    start.failed !== true &&
    now - start.startedAt < startLifetime &&
    !reports.some((r) => r.startId === start.id)
  );
}

export const listedCheckStatuses = ['checked', 'flagged', 'running', 'stale', 'none'] as const;
export type ListedCheckStatus = (typeof listedCheckStatuses)[number];

/**
 * A version's check status for the list: checked or flagged by its current report, else running
 * while a start is live, else stale when an older report exists, else none. A clean report reads
 * as checked only while no other report of the same key in its lifetime was flagged, so checking
 * a version again until the model happens to agree never makes it checked.
 */
export function listedCheckStatus(
  reports: readonly (ReportMeta & { readonly clean: boolean })[],
  starts: readonly CheckStart[],
  key: ReportKey,
  now: number,
): ListedCheckStatus {
  const current = currentReport(reports, key, now);
  if (current !== undefined) {
    return liveReports(reports, key, now).every(({ clean }) => clean) ? 'checked' : 'flagged';
  }
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
 * The versions the activation screen starts by itself, in the order given: each with no current
 * report and no live start, within what is left of the automatic share of the last 24 hours.
 */
export function versionsToStart<C extends StartCandidate>(
  candidates: readonly C[],
  startsInWindow: number,
  now: number,
): C[] {
  const left = Math.max(0, maxAutomaticStartsPerDay - startsInWindow);
  return candidates
    .filter(
      (candidate) =>
        currentReport(candidate.reports, candidate.key, now) === undefined &&
        !candidate.starts.some((start) => liveStart(start, candidate.reports, now)),
    )
    .slice(0, left);
}

/** What happens when an admin asks for one version's check now. */
export type RequestedStart<S extends CheckStart> =
  { readonly outcome: 'live'; readonly start: S } | { readonly outcome: 'start' };

/**
 * An admin's own start of one version, whatever its reports say: its live start is answered in
 * place of a second one, and otherwise it starts.
 */
export function requestedStart<S extends CheckStart>(
  starts: readonly S[],
  reports: readonly Pick<ReportMeta, 'startId'>[],
  now: number,
): RequestedStart<S> {
  const live = newestStart(starts.filter((start) => liveStart(start, reports, now)));
  return live === undefined ? { outcome: 'start' } : { outcome: 'live', start: live };
}
