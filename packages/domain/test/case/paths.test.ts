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
    expect(partners.missingMarkers).toEqual([{ personId: 'p1', marker: 'partners' }]);
    expect(followPath(family, 'p1', ['child'], today).missingMarkers).toEqual([]);
  });

  it('returns each person once, with every edge they were reached by', () => {
    const remarried = indexSnapshot(
      snapshot({
        people: [{ id: 'p1' }, { id: 'p2' }, { id: 's1' }, { id: 'm1' }, { id: 'f1' }],
        relationships: [
          { kind: 'spouse', people: ['p1', 'p2'], start: '2001-01-01' },
          { kind: 'spouse', people: ['p1', 'p2'], start: '2010-01-01', end: 'none' },
          { kind: 'parent', parent: 'm1', child: 'p1', parentKind: 'biological' },
          { kind: 'parent', parent: 'f1', child: 'p1', parentKind: 'biological' },
          { kind: 'parent', parent: 'm1', child: 's1', parentKind: 'biological' },
          { kind: 'parent', parent: 'f1', child: 's1', parentKind: 'biological' },
        ],
      }),
    );
    const spouses = followPath(remarried, 'p1', ['spouse'], today).reached;
    expect(spouses.map(({ id, reached, arrivals }) => [id, reached, arrivals.length])).toEqual([
      ['p2', true, 2],
    ]);
    const siblings = followPath(remarried, 'p1', ['parent', 'child'], today).reached;
    expect(siblings.map(({ id, arrivals }) => [id, arrivals.length])).toEqual([['s1', 2]]);
  });

  it('keeps first edges apart only when asked, merging walks that share their edges', () => {
    // Synthetic: p1 married p2 twice; c1 is p2's child, and neither p1 nor p2 lists all children.
    const first = { kind: 'spouse', people: ['p1', 'p2'], start: '2001-01-01' };
    const second = { kind: 'spouse', people: ['p1', 'p2'], start: '2010-01-01', end: 'none' };
    const birth = { kind: 'parent', parent: 'p2', child: 'c1', parentKind: 'biological' };
    const value = indexSnapshot(
      snapshot({
        people: [{ id: 'p1' }, { id: 'p2' }, { id: 'c1', birthDate: '2005-01-01' }],
        relationships: [first, second, birth],
      }),
    );
    const merged = followPath(value, 'p1', ['spouse', 'child'], today).reached;
    expect(
      merged[0]?.arrivals.map(({ firstEdge, edge, reached }) => [firstEdge, edge, reached]),
    ).toEqual([[undefined, birth, true]]);
    const { reached, missingMarkers } = followPath(value, 'p1', ['spouse', 'child'], today, true);
    const [child] = reached;
    expect(
      child?.arrivals.map(({ firstEdge, edge, reached }) => [firstEdge, edge, reached]),
    ).toEqual([
      [first, birth, 'unknown'],
      [second, birth, true],
    ]);
    expect(child?.reached).toBe(true);
    expect(missingMarkers).toEqual([
      { personId: 'p1', marker: 'spouses' },
      { personId: 'p2', marker: 'children' },
    ]);
  });

  it('stays small when many couple edges join the same two people', () => {
    // Synthetic: p1 and p2 share the most couple edges a snapshot allows, all current.
    const edges = ['2001', '2002', '2003', '2004'].map((year) => ({
      kind: 'partner',
      people: ['p1', 'p2'],
      start: `${year}-01-01`,
      end: 'none',
    }));
    const value = indexSnapshot(
      snapshot({ people: [{ id: 'p1' }, { id: 'p2' }], relationships: edges }),
    );
    const steps = ['partner', 'partner', 'partner'] as const;
    expect(followPath(value, 'p1', steps, today).reached[0]?.arrivals).toHaveLength(4);
    expect(followPath(value, 'p1', steps, today, true).reached[0]?.arrivals).toHaveLength(16);
  });

  it('names the edges whose validity is unknown, and none once a path certainly holds', () => {
    const before = parseCalendarDate('2020-01-01');
    // Synthetic: p2 was adopted by p1 on an unknown date; p3 is p2's child, born 2019.
    const adoption = { kind: 'parent', parent: 'p1', child: 'p2', parentKind: 'adoptive' };
    const birth = { kind: 'parent', parent: 'p2', child: 'p3', parentKind: 'biological' };
    const value = indexSnapshot(
      snapshot({
        people: [
          { id: 'p1' },
          { id: 'p2', birthDate: '2000-01-01' },
          { id: 'p3', birthDate: '2019-01-01' },
        ],
        relationships: [adoption, birth],
      }),
    );
    const [grandchild] = followPath(value, 'p1', ['child', 'child'], before).reached;
    expect(grandchild).toMatchObject({ id: 'p3', reached: 'unknown', uncertainEdges: [adoption] });
    expect(grandchild?.arrivals).toMatchObject([{ edge: birth, uncertainEdges: [adoption] }]);
    expect(followPath(value, 'p1', ['child', 'child'], today).reached).toMatchObject([
      { id: 'p3', reached: true, uncertainEdges: [] },
    ]);
    expect(ancestorLines(value, 'p3', 2, before).lines).toMatchObject([
      { path: ['p2', 'p3'], reached: true, uncertainEdges: [] },
      { path: ['p1', 'p2', 'p3'], reached: 'unknown', uncertainEdges: [adoption] },
    ]);
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
    const { lines, missingMarkers } = ancestorLines(value, 'p1', 2, today);
    expect(lines.map((line) => line.path)).toEqual([
      ['p2', 'p1'],
      ['p3', 'p1'],
      ['g1', 'p2', 'p1'],
      ['g1', 'p3', 'p1'],
    ]);
    expect(missingMarkers).toEqual([]);
    expect(ancestorLines(value, 'p1', 3, today).missingMarkers).toEqual([
      { personId: 'g1', marker: 'parents' },
    ]);
  });
});
