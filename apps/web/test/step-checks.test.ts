import { describe, expect, it } from 'vitest';
import {
  pointTone,
  shownPoints,
  stepTallies,
  tallyTone,
  pointCount,
  totalTally,
} from '../src/knowledge/step-checks.js';

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

describe('pointCount', () => {
  it('adds the three counts', () => {
    expect(pointCount({ matches: 2, differs: 1, unread: 4 })).toBe(7);
  });
});

describe('totalTally', () => {
  it('adds every step up', () => {
    expect(
      totalTally([
        { matches: 1, differs: 0, unread: 2 },
        { matches: 2, differs: 1, unread: 0 },
      ]),
    ).toEqual({ matches: 3, differs: 1, unread: 2 });
  });
});

describe('pointTone', () => {
  it.each([
    ['matches', 'ok'],
    ['differs', 'differs'],
    ['could_not_check', 'unread'],
  ] as const)('%s reads as %s', (status, tone) => {
    expect(pointTone(status)).toBe(tone);
  });
});

describe('shownPoints', () => {
  const item = (status: 'matches' | 'differs' | 'could_not_check') => ({
    key: `requirement:${status}`,
    kind: 'requirement' as const,
    title: 'A requirement',
    status,
    quotes: [],
    note: null,
    reason: null,
    citations: [],
    values: [],
  });

  it('shows nothing without a report', () => {
    expect(shownPoints(null)).toEqual([]);
    expect(shownPoints(undefined)).toEqual([]);
  });

  it('keeps a model report as it is', () => {
    const items = [item('matches'), item('differs')];
    expect(shownPoints({ items, scripted: false })).toBe(items);
  });

  it('never shows a scripted match as confirmed', () => {
    const shown = shownPoints({ items: [item('matches'), item('differs')], scripted: true });
    expect(shown.map(({ status }) => status)).toEqual(['could_not_check', 'differs']);
  });
});
