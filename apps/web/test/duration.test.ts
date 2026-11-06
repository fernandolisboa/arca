import { describe, expect, it } from 'vitest';
import { durationParts } from '../src/knowledge/duration.js';

describe('durationParts', () => {
  it.each([
    [
      'P1Y6M',
      [
        { unit: 'year', count: 1 },
        { unit: 'month', count: 6 },
      ],
    ],
    ['P2Y', [{ unit: 'year', count: 2 }]],
    ['P90D', [{ unit: 'day', count: 90 }]],
    ['P0Y3M', [{ unit: 'month', count: 3 }]],
    ['PT1H', null],
  ])('reads %s', (value, expected) => {
    expect(durationParts(value)).toEqual(expected);
  });
});
