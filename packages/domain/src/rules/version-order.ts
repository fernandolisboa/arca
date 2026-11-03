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
 * that corrects nothing starts strictly after every lower-numbered version. A correction is judged
 * by what it does to selection over the versions below it (`correctionProblem`). Returns the
 * problems by version number.
 */
export function checkVersionOrder(versions: readonly VersionDates[]): Map<number, string[]> {
  const problems = new Map<number, string[]>();
  const sorted = [...versions].sort((left, right) => left.number - right.number);
  for (const version of sorted) {
    const lower = sorted.filter((other) => other.number < version.number);
    const problem =
      version.corrects === undefined
        ? lower.some((other) => compareDates(version.effectiveFrom, other.effectiveFrom) <= 0)
          ? 'A version that corrects nothing starts after every lower-numbered version'
          : undefined
        : correctionProblem(version, version.corrects, lower);
    if (problem !== undefined) problems.set(version.number, [problem]);
  }
  return problems;
}

/**
 * Adding a correction of `target` to the lower versions, all treated as active, must make selection
 * pick it, from its `effectiveFrom` on, on every date where it picked the target, a correction of
 * the target (directly or through a chain) or a version the correction's own chain removes. A
 * correction that starts before that group's first date also takes the run just before it, but
 * not the whole run unless that version is in its chain. Every other date keeps its version, and
 * the correction is in effect on some date. So a correction never shadows a version it does not
 * fix, and a newer correction is never shadowed by an older one.
 */
function correctionProblem(
  correction: VersionDates,
  target: number,
  lower: readonly VersionDates[],
): string | undefined {
  const byNumber = new Map(lower.map((version) => [version.number, version]));
  const removes = new Set(chainOf(correction.corrects, byNumber));
  const group = new Set(
    lower
      .filter(
        (version) =>
          version.number === target || chainOf(version.corrects, byNumber).includes(target),
      )
      .map((version) => version.number),
  );
  const dates = [...new Set([...lower, correction].map((version) => version.effectiveFrom))].sort(
    compareDates,
  );
  const before = selector(lower);
  const after = selector([...lower, correction]);
  const groupStart = dates.find((date) => isIn(group, before(date)));
  if (groupStart === undefined) {
    return 'The corrected version is never in effect, so it cannot be fixed';
  }
  const runBefore = dates.filter((date) => compareDates(date, groupStart) < 0).at(-1);
  const previous = runBefore === undefined ? undefined : before(runBefore);
  if (previous !== undefined && !removes.has(previous)) {
    const previousStart = dates.find((date) => before(date) === previous);
    if (previousStart !== undefined && compareDates(correction.effectiveFrom, previousStart) <= 0) {
      return `A correction starts after the start of version ${String(previous)}'s period, which it does not fix`;
    }
  }
  let inEffect = false;
  for (const date of dates) {
    const was = before(date);
    const taken =
      compareDates(date, correction.effectiveFrom) >= 0 &&
      (isIn(group, was) ||
        isIn(removes, was) ||
        (compareDates(date, groupStart) < 0 && was === previous));
    const expected = taken ? correction.number : was;
    const actual = after(date);
    if (actual !== expected) {
      return `From ${date}, selection would pick ${describe(actual)} instead of ${describe(expected)}`;
    }
    inEffect ||= taken;
  }
  return inEffect
    ? undefined
    : 'A correction starts before the period of the version it fixes ends';
}

/** The versions a correction removes in turn: the one it names, the one that names, and so on. */
function chainOf(
  corrects: number | undefined,
  byNumber: ReadonlyMap<number, VersionDates>,
): number[] {
  const chain: number[] = [];
  for (let next = corrects; next !== undefined && !chain.includes(next);) {
    chain.push(next);
    next = byNumber.get(next)?.corrects;
  }
  return chain;
}

/** The number of the version selection picks on a date, with every version active. */
function selector(versions: readonly VersionDates[]): (date: CalendarDate) => number | undefined {
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
  return (date) => selectVersion(identities, date, states)?.identity.number;
}

function isIn(numbers: ReadonlySet<number>, number: number | undefined): boolean {
  return number !== undefined && numbers.has(number);
}

function describe(number: number | undefined): string {
  return number === undefined ? 'no version' : `version ${String(number)}`;
}
