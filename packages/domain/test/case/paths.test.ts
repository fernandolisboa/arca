import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import { indexSnapshot } from '../../src/case/graph.js';
import { ancestorLines, followPath } from '../../src/case/paths.js';
import { snapshot } from './builders.js';

const today = parseCalendarDate('2026-11-03');

describe('followPath', () => {
  // Synthetic family: p1 married to p2 (current) and formerly to p3; p2's parent p4; p1's child p5.
  const family = indexSnapshot(
    snapshot({
      people: [
        { id: 'p1', recordedInFull: ['spouses', 'children'] },
        { id: 'p2', recordedInFull: ['parents'] },
        { id: 'p3' },
        { id: 'p4' },
        { id: 'p5', birthDate: '2015-01-01' },
        { id: 'p6' },
      ],
      relationships: [
        { kind: 'spouse', people: ['p1', 'p2'], start: '2012-01-01', end: 'none' },
        { kind: 'spouse', people: ['p1', 'p3'], start: '2001-01-01', end: '2005-01-01' },
        { kind: 'parent', parent: 'p4', child: 'p2', parentKind: 'biological' },
        { kind: 'parent', parent: 'p1', child: 'p5', parentKind: 'biological' },
        { kind: 'partner', people: ['p1', 'p6'] },
      ],
    }),
  );
  const ids = (steps: Parameters<typeof followPath>[2]): unknown =>
    followPath(family, 'p1', steps, today).reached.map(({ id, reached }) => [id, reached]);

  it('reaches a current spouse, never an ex-spouse', () => {
    expect(ids(['spouse'])).toEqual([['p2', true]]);
  });

  it("composes steps, such as the spouse's parents", () => {
    expect(ids(['spouse', 'parent'])).toEqual([['p4', true]]);
  });

  it('reaches someone across an undated edge only possibly, and reports missing markers', () => {
    const partners = followPath(family, 'p1', ['partner'], today);
    expect(partners.reached.map(({ id, reached }) => [id, reached])).toEqual([['p6', 'unknown']]);
    expect(partners.complete).toBe(false);
    expect(followPath(family, 'p1', ['child'], today).complete).toBe(true);
  });

  it('never returns the principal', () => {
    expect(ids(['child', 'parent'])).toEqual([]);
  });
});

describe('ancestorLines', () => {
  it('returns one line per path, so pedigree collapse keeps each line', () => {
    // Synthetic collapse: p2 and p3 are both children of g1, and both parents of p1.
    const value = indexSnapshot(
      snapshot({
        people: [
          { id: 'p1', recordedInFull: ['parents'] },
          { id: 'p2', recordedInFull: ['parents'] },
          { id: 'p3', recordedInFull: ['parents'] },
          { id: 'g1' },
        ],
        relationships: [
          { kind: 'parent', parent: 'p2', child: 'p1' },
          { kind: 'parent', parent: 'p3', child: 'p1' },
          { kind: 'parent', parent: 'g1', child: 'p2' },
          { kind: 'parent', parent: 'g1', child: 'p3' },
        ],
      }),
    );
    const { lines, complete } = ancestorLines(value, 'p1', 2, today);
    expect(lines.map((line) => line.path)).toEqual([
      ['p2', 'p1'],
      ['p3', 'p1'],
      ['g1', 'p2', 'p1'],
      ['g1', 'p3', 'p1'],
    ]);
    expect(complete).toBe(true);
    expect(ancestorLines(value, 'p1', 3, today).complete).toBe(false);
  });
});
