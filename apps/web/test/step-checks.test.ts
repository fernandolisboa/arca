import { describe, expect, it } from 'vitest';
import { stepTallies, tallyTone, tallyTotal } from '../src/knowledge/step-checks.js';

describe('stepTallies', () => {
  it('counts each step’s points by how they came out', () => {
    const tallies = stepTallies([
      { kind: 'requirement', status: 'matches' },
      { kind: 'requirement', status: 'differs' },
      { kind: 'requirement', status: 'could_not_check' },
      { kind: 'cost', status: 'matches' },
    ]);
    expect(tallies.get('requirements')).toEqual({ matches: 1, differs: 1, unread: 1 });
    expect(tallies.get('costs')).toEqual({ matches: 1, differs: 0, unread: 0 });
  });

  it('puts the leap-day and closure points on the settings step', () => {
    const tallies = stepTallies([
      { kind: 'leapDayBirthday', status: 'matches' },
      { kind: 'closure', status: 'could_not_check' },
    ]);
    expect(tallies.get('settings')).toEqual({ matches: 1, differs: 0, unread: 1 });
  });

  it.each([
    ['assessment', 'assessments'],
    ['dependent', 'dependents'],
    ['duration', 'durations'],
    ['countrySet', 'countrySets'],
  ] as const)('shows a %s point on the %s step', (kind, step) => {
    expect([...stepTallies([{ kind, status: 'matches' }]).keys()]).toEqual([step]);
  });

  it('gives a step with no checked point no tally', () => {
    const tallies = stepTallies([{ kind: 'cost', status: 'matches' }]);
    expect(tallies.has('sources')).toBe(false);
    expect(tallies.has('cases')).toBe(false);
  });
});

describe('tallyTone', () => {
  it.each([
    { name: 'every point matches', tally: { matches: 2, differs: 0, unread: 0 }, tone: 'ok' },
    { name: 'one is unread', tally: { matches: 2, differs: 0, unread: 1 }, tone: 'unread' },
    { name: 'one differs', tally: { matches: 2, differs: 1, unread: 0 }, tone: 'differs' },
    { name: 'differs and unread', tally: { matches: 0, differs: 1, unread: 3 }, tone: 'differs' },
  ] as const)('$name: $tone', ({ tally, tone }) => {
    expect(tallyTone(tally)).toBe(tone);
  });
});

describe('tallyTotal', () => {
  it('adds the three counts', () => {
    expect(tallyTotal({ matches: 2, differs: 1, unread: 4 })).toBe(7);
  });
});
