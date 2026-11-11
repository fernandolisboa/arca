import type { VersionCheckReport } from '@arca/api-contract/client';
import type { StepKey } from './steps.js';

type ReportItem = VersionCheckReport['items'][number];
type CheckedPoint = Pick<ReportItem, 'kind' | 'status'>;

/** The review step that shows each kind of checked item. */
const stepOfKind = {
  requirement: 'requirements',
  assessment: 'assessments',
  dependent: 'dependents',
  cost: 'costs',
  duration: 'durations',
  countrySet: 'countrySets',
  leapDayBirthday: 'settings',
  closure: 'settings',
} as const satisfies Record<ReportItem['kind'], StepKey>;

/** How a step's checked points came out; `unread` are the ones the check could not confirm. */
export interface StepTally {
  readonly matches: number;
  readonly differs: number;
  readonly unread: number;
}

export type TallyTone = 'ok' | 'differs' | 'unread';

/** Each step's tally, for the steps that have checked points; the others have no entry. */
export function stepTallies(items: readonly CheckedPoint[]): ReadonlyMap<StepKey, StepTally> {
  const tallies = new Map<StepKey, StepTally>();
  for (const { kind, status } of items) {
    const step = stepOfKind[kind];
    const before = tallies.get(step) ?? { matches: 0, differs: 0, unread: 0 };
    tallies.set(step, {
      matches: before.matches + (status === 'matches' ? 1 : 0),
      differs: before.differs + (status === 'differs' ? 1 : 0),
      unread: before.unread + (status === 'matches' || status === 'differs' ? 0 : 1),
    });
  }
  return tallies;
}

export const tallyTotal = ({ matches, differs, unread }: StepTally): number =>
  matches + differs + unread;

/** A difference outranks an unread point, and only a step where every point matches reads as fine. */
export function tallyTone({ differs, unread }: StepTally): TallyTone {
  if (differs > 0) return 'differs';
  return unread > 0 ? 'unread' : 'ok';
}
