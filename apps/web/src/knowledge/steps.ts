import type { VersionView } from '@arca/api-contract/client';

/** The view's sections that are lists of items, in review order. */
export const listedSections = [
  'requirements',
  'assessments',
  'dependents',
  'costs',
  'durations',
  'countrySets',
  'sources',
  'cases',
] as const satisfies readonly (keyof VersionView)[];

export type Listed = (typeof listedSections)[number];

export interface ListedStep {
  readonly key: Listed;
  readonly count: number;
}

export type Step = { readonly key: 'changes' | 'settings' | 'decision' } | ListedStep;

export type StepKey = Step['key'];

/** How many items each list section of the version holds, empty ones included. */
export function sectionCounts(view: Pick<VersionView, Listed>): readonly ListedStep[] {
  return listedSections.map((key) => ({ key, count: view[key].length }));
}

/**
 * The review's steps, built from the version's own sections: what changed and the version's
 * settings first, then every list that has items, then the decision. An empty list gets no step;
 * the decision step still counts it, so nothing goes missing silently. A list section the view
 * gains needs an entry in `listedSections`, a pt-BR label and a renderer.
 */
export function reviewSteps(view: Pick<VersionView, Listed>): readonly Step[] {
  return [
    { key: 'changes' },
    { key: 'settings' },
    ...sectionCounts(view).filter(({ count }) => count > 0),
    { key: 'decision' },
  ];
}
