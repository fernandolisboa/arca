import { type CalendarDate, daysBetween } from '../calendar/calendar-date.js';
import type { CatalogEntry } from './catalog.js';
import type { Source } from './route-version.js';

/** A source is stale when it was verified more than this many days before `today` (spec 0002, R9). */
export const staleAfterDays = 90;

export interface StaleSource {
  readonly source: Source;
  readonly daysSinceVerified: number;
  /** The pinned country set the source belongs to; absent for the version's own sources. */
  readonly countrySet?: { readonly id: string; readonly number: number };
}

/**
 * The sources an entry cites that are stale at `today`: the version's sources that any rule,
 * assessment, cost, duration, closure or leap-day choice cites, in the version's source order, then
 * every source of each country set it pins, in pin order.
 */
export function staleSources(entry: CatalogEntry, today: CalendarDate): StaleSource[] {
  const { version } = entry;
  const cited = new Set([
    ...version.requirements.flatMap((each) => each.sources),
    ...version.assessments.flatMap((each) => each.sources),
    ...version.dependents.flatMap((each) => each.sources),
    ...version.costs.flatMap((each) => each.sources),
    ...version.durations.flatMap((each) => each.sources),
    ...(version.closureSources ?? []),
    ...(version.leapDayBirthdaySources ?? []),
  ]);
  const stale = (source: Source) => {
    const daysSinceVerified = daysBetween(source.verifiedAt, today);
    return daysSinceVerified > staleAfterDays ? [{ source, daysSinceVerified }] : [];
  };
  return [
    ...version.sources.filter((source) => cited.has(source.id)).flatMap(stale),
    ...entry.countrySets.flatMap(({ id, number, sources }) =>
      sources.flatMap(stale).map((each) => ({ ...each, countrySet: { id, number } })),
    ),
  ];
}
