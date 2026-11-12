import { describe, expect, it } from 'vitest';
import { shownCents } from '../src/knowledge/check-cost.js';

describe('shownCents', () => {
  it.each<[number, number | 'under_cent']>([
    [0, 0],
    [1, 'under_cent'],
    [4_999, 'under_cent'],
    [5_000, 1],
    [283_000, 28],
    [285_000, 29],
    [1_234_567, 123],
  ])('shows %i millionths of a dollar as %s', (microUsd, expected) => {
    expect(shownCents(microUsd)).toBe(expected);
  });
});
