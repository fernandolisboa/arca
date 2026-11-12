import { type DecisionStates, type VersionIdentity, stateOf } from './catalog.js';
import type { VersionView } from './version-view.js';

/**
 * What a correction request points at (ADR-0029): the whole version, its settings, or one item
 * named by the kind and key the version view and the check items already use.
 */
export const correctionItemKinds = [
  'version',
  'settings',
  'requirement',
  'assessment',
  'dependent',
  'cost',
  'duration',
  'countrySet',
] as const;
export type CorrectionItemKind = (typeof correctionItemKinds)[number];

/** The kinds that name one item, so a request on them carries the item's key. */
export type KeyedCorrectionItemKind = Exclude<CorrectionItemKind, 'version' | 'settings'>;
export const keyedCorrectionItemKinds: readonly CorrectionItemKind[] = correctionItemKinds.filter(
  (kind): kind is KeyedCorrectionItemKind => kind !== 'version' && kind !== 'settings',
);

/** One item a request can name: its key, as the check items write it, and its title. */
export interface CorrectionTarget {
  readonly key: string;
  readonly title: string;
}

/** The items of a version a request can name, by kind. */
export function correctionTargets(
  view: Pick<
    VersionView,
    'requirements' | 'assessments' | 'dependents' | 'costs' | 'durations' | 'countrySets'
  >,
): Readonly<Record<KeyedCorrectionItemKind, readonly CorrectionTarget[]>> {
  const titled = (items: readonly { id: string; title: string }[]) =>
    items.map(({ id, title }) => ({ key: id, title }));
  return {
    requirement: titled(view.requirements),
    assessment: titled(view.assessments),
    dependent: titled(view.dependents),
    cost: titled(view.costs),
    duration: titled(view.durations),
    countrySet: view.countrySets.map(({ id, number, title }) => ({
      key: countrySetKey(id, number),
      title,
    })),
  };
}

/** A country set's key in a request, as the check items write it. */
export const countrySetKey = (id: string, number: number) => `${id}/${String(number)}`;

export const correctionStates = ['open', 'taken', 'answered', 'closed'] as const;
export type CorrectionState = (typeof correctionStates)[number];

/** One stored event of a request, oldest first or in any order. */
export type CorrectionEvent =
  | { readonly kind: 'taken' }
  | { readonly kind: 'answered'; readonly proposedVersion: number | null }
  | { readonly kind: 'closed' };

/** Whether `identity` corrects version `target`, directly or through the versions it corrects. */
function correctsThrough(
  identity: VersionIdentity,
  target: number,
  byNumber: ReadonlyMap<number, VersionIdentity>,
): boolean {
  const seen = new Set<number>();
  for (
    let corrected = identity.corrects;
    corrected !== undefined && !seen.has(corrected);
    corrected = byNumber.get(corrected)?.corrects
  ) {
    if (corrected === target) return true;
    seen.add(corrected);
  }
  return false;
}

/**
 * A request's state (ADR-0029), from its events and the route's version identities and decision
 * states: closed by an admin, once the version an answer proposed is decided, or once any
 * correction of the request's version is active; else answered, taken or open, by its events.
 */
export function correctionState({
  versionNumber,
  events,
  identities,
  states,
}: {
  readonly versionNumber: number;
  readonly events: readonly CorrectionEvent[];
  /** Every version identity of the request's route. */
  readonly identities: readonly VersionIdentity[];
  readonly states: DecisionStates;
}): CorrectionState {
  if (events.some(({ kind }) => kind === 'closed')) return 'closed';
  const byNumber = new Map(identities.map((identity) => [identity.number, identity]));
  const corrected = identities.some(
    (identity) =>
      correctsThrough(identity, versionNumber, byNumber) && stateOf(identity, states) === 'active',
  );
  if (corrected) return 'closed';
  const answers = events.filter((event) => event.kind === 'answered');
  const decided = answers.some((answer) => {
    if (answer.proposedVersion === null) return false;
    const proposed = byNumber.get(answer.proposedVersion);
    return proposed !== undefined && stateOf(proposed, states) !== 'proposed';
  });
  if (decided) return 'closed';
  if (answers.length > 0) return 'answered';
  return events.some(({ kind }) => kind === 'taken') ? 'taken' : 'open';
}
