import { describe, expect, it } from 'vitest';
import {
  type ReviewFilter,
  type ReviewNeed,
  filtering,
  needCounts,
  noFilter,
  passes,
  reviewNeed,
  reviewOrder,
  toggleNeed,
} from '../src/knowledge/review-order.js';

const points = (matches: number, differs: number, unread: number) => ({ matches, differs, unread });

describe('reviewNeed', () => {
  it.each([
    { name: 'a point differs', check: 'flagged', points: points(5, 1, 3), need: 'differs' },
    { name: 'a clean check', check: 'checked', points: points(4, 0, 0), need: 'ready' },
    { name: 'points not confirmed', check: 'flagged', points: points(2, 0, 3), need: 'unread' },
    { name: 'still running', check: 'running', points: null, need: 'unchecked' },
    { name: 'stale', check: 'stale', points: null, need: 'unchecked' },
    { name: 'never checked', check: 'none', points: null, need: 'unchecked' },
  ] as const)('$name: $need', ({ check, points: counted, need }) => {
    expect(reviewNeed({ check, points: counted })).toBe(need);
  });
});

describe('reviewOrder', () => {
  const version = (
    title: string,
    country: string,
    check: 'checked' | 'flagged' | 'none',
    counted: ReturnType<typeof points> | null,
  ) => ({ title, country, check, points: counted });
  const names: Record<string, string> = { LV: 'Letônia', PT: 'Portugal', US: 'Estados Unidos' };
  const name = (country: string) => names[country] ?? country;

  it('puts countries with a difference first, then by name, and orders inside each', () => {
    const groups = reviewOrder(
      [
        version('D8', 'PT', 'flagged', points(0, 0, 23)),
        version('EB-5', 'US', 'flagged', points(11, 0, 8)),
        version('D7', 'PT', 'flagged', points(1, 0, 22)),
        version('Set', 'LV', 'checked', points(1, 0, 0)),
        version('Capital', 'LV', 'flagged', points(7, 1, 4)),
        version('Draft', 'US', 'none', null),
      ],
      name,
    );
    expect(groups.map(({ country, versions }) => [country, versions.map((v) => v.title)])).toEqual([
      ['LV', ['Capital', 'Set']],
      ['US', ['EB-5', 'Draft']],
      ['PT', ['D7', 'D8']],
    ]);
  });

  it('puts the version with more differences first', () => {
    const [group] = reviewOrder(
      [
        version('One', 'LV', 'flagged', points(0, 1, 0)),
        version('Two', 'LV', 'flagged', points(0, 2, 0)),
      ],
      name,
    );
    expect(group?.versions.map(({ title }) => title)).toEqual(['Two', 'One']);
  });

  it('answers nothing for no versions', () => {
    expect(reviewOrder([], name)).toEqual([]);
  });
});

describe('the review filter', () => {
  const version = (country: string, check: 'checked' | 'flagged' | 'none', differs: number) => ({
    country,
    check,
    points: check === 'none' ? null : points(1, differs, check === 'flagged' ? 2 : 0),
  });
  const listed = [
    version('US', 'flagged', 1),
    version('US', 'checked', 0),
    version('US', 'none', 0),
    version('PT', 'flagged', 0),
    version('PT', 'flagged', 2),
  ];
  const shown = (filter: ReviewFilter) => listed.filter((v) => passes(filter, v)).length;

  it('shows everything with nothing picked', () => {
    expect(filtering(noFilter)).toBe(false);
    expect(shown(noFilter)).toBe(5);
  });

  const narrowed = (country: string | null, needs: ReviewNeed[]): ReviewFilter => ({
    country,
    needs: new Set(needs),
  });

  it.each([
    { name: 'one country', filter: narrowed('PT', []), count: 2 },
    { name: 'one need', filter: narrowed(null, ['differs']), count: 2 },
    { name: 'several needs', filter: narrowed(null, ['ready', 'unchecked']), count: 2 },
    { name: 'country and need', filter: narrowed('US', ['differs']), count: 1 },
    { name: 'nothing left', filter: narrowed('PT', ['ready']), count: 0 },
  ])('narrows to $name', ({ filter, count }) => {
    expect(filtering(filter)).toBe(true);
    expect(shown(filter)).toBe(count);
  });

  it('counts each need inside the country, whatever needs are picked', () => {
    expect(needCounts(listed, narrowed('US', ['ready']))).toEqual({
      differs: 1,
      ready: 1,
      unread: 0,
      unchecked: 1,
    });
    expect(needCounts(listed, noFilter)).toEqual({ differs: 2, ready: 1, unread: 1, unchecked: 1 });
  });

  it('picks a need, and drops it when picked again', () => {
    const picked = toggleNeed(noFilter, 'unread');
    expect([...picked.needs]).toEqual(['unread']);
    expect(toggleNeed(picked, 'unread').needs.size).toBe(0);
    expect(noFilter.needs.size).toBe(0);
  });
});
