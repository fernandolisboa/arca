import { describe, expect, it } from 'vitest';
import { listedSections, reviewSteps, sectionCounts, stateTone } from '../src/knowledge/steps.js';

/** A view's list sections with the given sizes; the steps read only how many items each holds. */
function lists(sizes: Partial<Record<(typeof listedSections)[number], number>> = {}) {
  const items = (count = 0) => Array.from({ length: count }) as never[];
  return {
    requirements: items(sizes.requirements),
    assessments: items(sizes.assessments),
    dependents: items(sizes.dependents),
    costs: items(sizes.costs),
    durations: items(sizes.durations),
    countrySets: items(sizes.countrySets),
    sources: items(sizes.sources),
    cases: items(sizes.cases),
  };
}

describe('reviewSteps', () => {
  it.each([
    ['every list empty', {}, ['changes', 'settings', 'decision']],
    [
      'only some lists filled, in the view order',
      { sources: 3, requirements: 2, cases: 1 },
      ['changes', 'settings', 'requirements', 'sources', 'cases', 'decision'],
    ],
    [
      'every list filled',
      Object.fromEntries(listedSections.map((key) => [key, 1])),
      ['changes', 'settings', ...listedSections, 'decision'],
    ],
  ])('with %s', (_, sizes, keys) => {
    expect(reviewSteps(lists(sizes)).map(({ key }) => key)).toEqual(keys);
  });

  it('carries each list step its item count', () => {
    expect(reviewSteps(lists({ costs: 4 }))).toContainEqual({ key: 'costs', count: 4 });
  });
});

describe('sectionCounts', () => {
  it('counts every list, empty ones too, so the decision step can name them', () => {
    expect(sectionCounts(lists({ dependents: 2 }))).toEqual(
      listedSections.map((key) => ({ key, count: key === 'dependents' ? 2 : 0 })),
    );
  });
});

describe('stateTone', () => {
  it.each([
    ['active', 'ok'],
    ['proposed', 'warn'],
    ['rejected', 'unknown'],
  ] as const)('shows a %s version as %s', (state, tone) => {
    expect(stateTone(state)).toBe(tone);
  });
});
