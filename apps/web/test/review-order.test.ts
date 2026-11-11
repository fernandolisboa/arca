import { describe, expect, it } from 'vitest';
import { reviewNeed, reviewOrder } from '../src/knowledge/review-order.js';

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
