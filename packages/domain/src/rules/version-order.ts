import { type CalendarDate, compareDates } from '../calendar/calendar-date.js';
import {
  type DecisionStates,
  type VersionIdentity,
  identityKey,
  selectVersion,
} from './catalog.js';

/** What the order checks read about a version. */
export interface VersionDates {
  readonly routeId: string;
  readonly number: number;
  readonly effectiveFrom: CalendarDate;
  readonly corrects?: number | undefined;
}

/**
 * Checks the dates of one route's versions (spec 0002, R6), given contiguous numbers. A version
 * that corrects nothing starts strictly after every lower-numbered version. A correction falls
 * inside the bounds set by the period of the version it fixes, and corrections of one version
 * never start earlier as their numbers grow. Returns the problems by version number.
 */
export function checkVersionOrder(versions: readonly VersionDates[]): Map<number, string[]> {
  const problems = new Map<number, string[]>();
  const report = (number: number, message: string): void => {
    problems.set(number, [...(problems.get(number) ?? []), message]);
  };
  const sorted = [...versions].sort((left, right) => left.number - right.number);
  const latestCorrection = new Map<number, VersionDates>();
  for (const version of sorted) {
    const lower = sorted.filter((other) => other.number < version.number);
    if (version.corrects === undefined) {
      if (lower.some((other) => compareDates(version.effectiveFrom, other.effectiveFrom) <= 0)) {
        report(
          version.number,
          'A version that corrects nothing starts after every lower-numbered version',
        );
      }
      continue;
    }
    const message = correctionBoundsProblem(
      version,
      lower.filter((other) => other.corrects !== version.corrects),
    );
    if (message !== undefined) report(version.number, message);
    const latest = latestCorrection.get(version.corrects);
    if (latest !== undefined && compareDates(version.effectiveFrom, latest.effectiveFrom) < 0) {
      report(
        version.number,
        `A correction of version ${String(version.corrects)} starts no earlier than version ${String(latest.number)}, which corrects it too`,
      );
    }
    if (latest === undefined || compareDates(version.effectiveFrom, latest.effectiveFrom) >= 0) {
      latestCorrection.set(version.corrects, version);
    }
  }
  return problems;
}

interface Segment {
  readonly start: CalendarDate;
  /** Undefined while every candidate is corrected away. */
  readonly number: number | undefined;
}

/**
 * The period of the corrected version is the run of dates on which selection over `lower` (the
 * lower-numbered versions without other corrections of the same version), all active, picks it.
 * The correction starts before that period ends and after the start of the period before it.
 */
function correctionBoundsProblem(
  correction: VersionDates,
  lower: readonly VersionDates[],
): string | undefined {
  const timeline = selectionTimeline(lower);
  const runs = timeline.flatMap((segment, index) =>
    segment.number === correction.corrects ? [index] : [],
  );
  const [index] = runs;
  if (index === undefined) return 'The corrected version is never in effect, so it cannot be fixed';
  if (runs.length > 1) return 'The corrected version is in effect in more than one period';
  const end = timeline[index + 1]?.start;
  const before = timeline[index - 1]?.start;
  if (end !== undefined && compareDates(correction.effectiveFrom, end) >= 0) {
    return 'A correction starts before the period of the version it fixes ends';
  }
  if (before !== undefined && compareDates(correction.effectiveFrom, before) <= 0) {
    return 'A correction starts after the start of the period before the version it fixes';
  }
  return undefined;
}

/** The selected version on each run of dates, as consecutive segments; nothing before the first. */
function selectionTimeline(versions: readonly VersionDates[]): Segment[] {
  const identities: VersionIdentity[] = versions.map(
    ({ routeId, number, effectiveFrom, corrects }) => ({
      routeId,
      number,
      effectiveFrom,
      ...(corrects === undefined ? {} : { corrects }),
      status: 'open',
      hash: '',
    }),
  );
  const states: DecisionStates = new Map(
    identities.map((identity) => [identityKey(identity), 'active']),
  );
  const dates = [...new Set(versions.map((version) => version.effectiveFrom))].sort(compareDates);
  const segments: Segment[] = [];
  for (const date of dates) {
    const number = selectVersion(identities, date, states)?.identity.number;
    const last = segments.at(-1);
    if (last === undefined ? number === undefined : last.number === number) continue;
    segments.push({ start: date, number });
  }
  return segments;
}
