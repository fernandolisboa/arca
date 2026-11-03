import type { CalendarDate } from '../calendar/calendar-date.js';
import type { FactEnvironment } from '../case/facts.js';
import { type IndexedSnapshot, assertRecordedBy, indexSnapshot } from '../case/graph.js';
import type { CaseSnapshot } from '../case/snapshot.js';
import type { FxTable } from '../money/fx.js';
import {
  type CatalogEntry,
  type DecisionStates,
  sameIdentity,
  versionIdentity,
} from './catalog.js';
import type { Frame } from './evaluate.js';
import type { RouteVersion } from './route-version.js';

/** Everything an evaluation depends on besides the snapshot and the catalog (spec 0002, R5). */
export interface EvaluationContext {
  /** Selects the version: today, or a filing date when a route keeps old rules for it. */
  readonly rulesAsOf: CalendarDate;
  /** Ages and elapsed times are computed at it; defaults to `rulesAsOf`. */
  readonly factsAsOf?: CalendarDate;
  /** Named dates, such as `filingDate`, that a version may read facts at. */
  readonly referenceDates?: ReadonlyMap<string, CalendarDate>;
  /** For staleness only. */
  readonly today: CalendarDate;
  readonly fx: FxTable;
  readonly states: DecisionStates;
  /** The engine's commit, recorded so an evaluation can be reproduced (ADR-0014). */
  readonly engineCommit: string;
}

/** What evaluating one given version reads: no decision states, since it does no selection. */
export type VersionContext = Omit<EvaluationContext, 'states'>;

/** A version bound to one snapshot and principal, checked once. */
export interface Prepared {
  readonly indexed: IndexedSnapshot;
  readonly entry: CatalogEntry;
  readonly version: RouteVersion;
  readonly principalId: string;
  readonly factsAsOf: CalendarDate;
  readonly referenceDates: ReadonlyMap<string, CalendarDate>;
  readonly countrySets: ReadonlyMap<string, readonly string[]>;
  readonly context: VersionContext;
}

/**
 * Checks what the caller must guarantee: an entry consistent with its identity and pins, a
 * principal who is a case member, and context dates on or before the snapshot's `recordedOn`.
 * A failure is a programming error, so it throws.
 */
export function prepare(
  snapshot: CaseSnapshot,
  entry: CatalogEntry,
  principalId: string,
  context: VersionContext,
): Prepared {
  const { version, identity } = entry;
  if (!sameIdentity(identity, versionIdentity(version, identity.hash))) {
    throw new RangeError('An entry whose identity is not its version');
  }
  const indexed = indexSnapshot(snapshot);
  if (!snapshot.members.includes(principalId)) throw new RangeError('The principal is a member');
  const { factsAsOf, referenceDates } = contextDates(indexed, context);
  const countrySets = new Map(
    version.countrySets.map((pin) => {
      const set = entry.countrySets.find(
        (candidate) => candidate.id === pin.id && candidate.number === pin.number,
      );
      if (set === undefined) throw new RangeError('A pinned country set is not in the entry');
      return [pin.id, set.members] as const;
    }),
  );
  return {
    indexed,
    entry,
    version,
    principalId,
    factsAsOf,
    referenceDates,
    countrySets,
    context,
  };
}

/** The context's dates, refused when any is after the snapshot's `recordedOn` (spec 0002, R3). */
export function contextDates(
  indexed: IndexedSnapshot,
  context: VersionContext,
): { factsAsOf: CalendarDate; referenceDates: ReadonlyMap<string, CalendarDate> } {
  const factsAsOf = context.factsAsOf ?? context.rulesAsOf;
  const referenceDates = context.referenceDates ?? new Map<string, CalendarDate>();
  assertRecordedBy(indexed, factsAsOf);
  for (const date of referenceDates.values()) assertRecordedBy(indexed, date);
  return { factsAsOf, referenceDates };
}

export function environmentOf(prepared: Prepared, unit?: FactEnvironment['unit']): FactEnvironment {
  const { indexed, version, principalId, factsAsOf, context } = prepared;
  return {
    snapshot: indexed,
    principalId,
    currency: version.currency,
    fx: context.fx,
    factsAsOf,
    routeCountry: version.country,
    ...(version.leapDayBirthday === undefined ? {} : { leapDayBirthday: version.leapDayBirthday }),
    ...(unit === undefined ? {} : { unit }),
  };
}

export function principalFrame(prepared: Prepared, environment: FactEnvironment): Frame {
  return {
    environment,
    at: prepared.factsAsOf,
    referenceDates: prepared.referenceDates,
    countrySets: prepared.countrySets,
    current: prepared.principalId,
  };
}
