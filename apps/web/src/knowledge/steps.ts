import type { VersionView } from '@arca/api-contract/client';
import type { Messages } from '@arca/i18n';
import type { StatusTone } from '@arca/ui';

export type SectionKey = keyof Messages['knowledge']['section'];

/** A list section of the view, with how many items it holds. */
type Listed = Exclude<SectionKey, 'changes' | 'settings'>;

/** The view's list sections, all these steps read of a version. */
type Lists = Pick<VersionView, Listed>;

const sizes = {
  requirements: (view) => view.requirements.length,
  assessments: (view) => view.assessments.length,
  dependents: (view) => view.dependents.length,
  costs: (view) => view.costs.length,
  durations: (view) => view.durations.length,
  countrySets: (view) => view.countrySets.length,
  sources: (view) => view.sources.length,
  cases: (view) => view.cases.length,
} as const satisfies Record<Listed, (view: Lists) => number>;

export const listedSections = Object.keys(sizes) as readonly Listed[];

export type Step =
  | { readonly key: 'changes' | 'settings' }
  | { readonly key: Listed; readonly count: number }
  | { readonly key: 'decision' };

/** How many items each list section of the version holds, empty ones included. */
export function sectionCounts(view: Lists): readonly { key: Listed; count: number }[] {
  return listedSections.map((key) => ({ key, count: sizes[key](view) }));
}

/**
 * The review's steps, built from the version's own sections, so a section the schema gains
 * becomes a step without a new screen: what changed and the version's settings first, then
 * every list that has items, then the decision. An empty list gets no step; the decision step
 * still counts it, so nothing goes missing silently.
 */
export function reviewSteps(view: Lists): readonly Step[] {
  return [
    { key: 'changes' },
    { key: 'settings' },
    ...sectionCounts(view).filter(({ count }) => count > 0),
    { key: 'decision' },
  ];
}

/** A version's state as a status chip's tone: active is ok, proposed waits, rejected is out. */
export function stateTone(state: VersionView['state']): StatusTone {
  switch (state) {
    case 'active':
      return 'ok';
    case 'proposed':
      return 'warn';
    case 'rejected':
      return 'unknown';
  }
}
