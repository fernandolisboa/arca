import { type CalendarDate, compareDates } from '../calendar/calendar-date.js';
import type { CountrySet, RouteVersion } from './route-version.js';

/**
 * A version's decision state (ADR-0014). `proposed` also covers a version whose rejection is still
 * pending, and is what a version without a verified decision is.
 */
export type DecisionState = 'active' | 'rejected' | 'proposed';

/** What selection may read about any version, proposed ones included: never its rules. */
export interface VersionIdentity {
  readonly routeId: string;
  readonly number: number;
  readonly effectiveFrom: CalendarDate;
  readonly corrects?: number;
  readonly status: RouteVersion['status'];
  /** The content hash over the version and every file it pins (spec 0002, R6). */
  readonly hash: string;
}

/** Decision states by `identityKey`. A version missing from it is proposed. */
export type DecisionStates = ReadonlyMap<string, DecisionState>;

/** A validated version with its identity and the pinned files the engine reads. */
export interface CatalogEntry {
  readonly identity: VersionIdentity;
  readonly version: RouteVersion;
  /** Exactly the country sets the version pins, at their pinned numbers. */
  readonly countrySets: readonly CountrySet[];
}

/**
 * The engine's view of the knowledge catalog (spec 0002, R5). A full entry is reachable only for an
 * active version, so the content of a proposed or rejected version never reaches an evaluation.
 */
export interface RouteCatalog {
  readonly identities: (routeId: string) => readonly VersionIdentity[];
  readonly activeEntry: (
    identity: VersionIdentity,
    states: DecisionStates,
  ) => CatalogEntry | undefined;
}

/** The key of a version in `DecisionStates`: an activation covers this exact content. */
export function identityKey(
  identity: Pick<VersionIdentity, 'routeId' | 'number' | 'hash'>,
): string {
  return `${identity.routeId}/${String(identity.number)}/${identity.hash}`;
}

/** Every identity field agrees, so the content evaluated is the content selected. */
export function sameIdentity(left: VersionIdentity, right: VersionIdentity): boolean {
  return (
    identityKey(left) === identityKey(right) &&
    left.effectiveFrom === right.effectiveFrom &&
    left.corrects === right.corrects &&
    left.status === right.status
  );
}

export function stateOf(identity: VersionIdentity, states: DecisionStates): DecisionState {
  return states.get(identityKey(identity)) ?? 'proposed';
}

export interface Selection {
  readonly identity: VersionIdentity;
  readonly state: DecisionState;
}

/**
 * The version in effect at `rulesAsOf`, among all versions of one route (spec 0002, R5). Candidates
 * are versions not rejected and already effective; each removes, at once, the chain of versions it
 * corrects, rejected or not. The latest `effectiveFrom` wins, then the highest number. Activation
 * is checked only after, so a newer proposed version is never skipped for an older active one.
 */
export function selectVersion(
  identities: readonly VersionIdentity[],
  rulesAsOf: CalendarDate,
  states: DecisionStates,
): Selection | undefined {
  const byNumber = new Map(identities.map((identity) => [identity.number, identity]));
  if (byNumber.size !== identities.length) throw new RangeError('Two versions share a number');
  if (new Set(identities.map((identity) => identity.routeId)).size > 1) {
    throw new RangeError('Versions of more than one route');
  }
  const candidates = identities.filter(
    (identity) =>
      stateOf(identity, states) !== 'rejected' &&
      compareDates(identity.effectiveFrom, rulesAsOf) <= 0,
  );
  const removed = new Set<number>();
  for (const candidate of candidates) {
    for (
      let corrected = candidate.corrects;
      corrected !== undefined && !removed.has(corrected);
      corrected = byNumber.get(corrected)?.corrects
    ) {
      removed.add(corrected);
    }
  }
  const selected = candidates
    .filter((identity) => !removed.has(identity.number))
    .reduce<VersionIdentity | undefined>(
      (best, identity) => (best === undefined || later(identity, best) ? identity : best),
      undefined,
    );
  return selected === undefined
    ? undefined
    : { identity: selected, state: stateOf(selected, states) };
}

/**
 * The first version, not active, that selection would pick at `rulesAsOf` or a later date in place
 * of `selected`: a pending rule change or correction the user should hear about (spec 0002, R5).
 */
export function newerProposedVersion(
  identities: readonly VersionIdentity[],
  selected: VersionIdentity,
  rulesAsOf: CalendarDate,
  states: DecisionStates,
): { readonly identity: VersionIdentity; readonly from: CalendarDate } | undefined {
  const dates = [
    rulesAsOf,
    ...identities
      .map((identity) => identity.effectiveFrom)
      .filter((date) => compareDates(date, rulesAsOf) > 0),
  ].sort(compareDates);
  for (const date of new Set(dates)) {
    const selection = selectVersion(identities, date, states);
    if (selection === undefined || selection.identity.number === selected.number) continue;
    if (selection.state !== 'active') return { identity: selection.identity, from: date };
  }
  return undefined;
}

function later(left: VersionIdentity, right: VersionIdentity): boolean {
  const order = compareDates(left.effectiveFrom, right.effectiveFrom);
  return order > 0 || (order === 0 && left.number > right.number);
}
