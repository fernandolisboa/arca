import { describe, expect, it } from 'vitest';
import { reviewOrder } from '../src/knowledge/review-order.js';

describe('reviewOrder', () => {
  const names: Record<string, string> = { LV: 'Letônia', PT: 'Portugal', US: 'Estados Unidos' };
  const name = (country: string) => names[country] ?? country;

  it('groups by country in name order, each country in title order', () => {
    const groups = reviewOrder(
      [
        { title: 'D8', country: 'PT' },
        { title: 'EB-5', country: 'US' },
        { title: 'D7', country: 'PT' },
        { title: 'Set', country: 'LV' },
        { title: 'Capital', country: 'LV' },
      ],
      name,
    );
    expect(groups.map(({ country, versions }) => [country, versions.map((v) => v.title)])).toEqual([
      ['US', ['EB-5']],
      ['LV', ['Capital', 'Set']],
      ['PT', ['D7', 'D8']],
    ]);
  });

  it('answers nothing for no versions', () => {
    expect(reviewOrder([], name)).toEqual([]);
  });
});
