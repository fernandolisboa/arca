import { describe, expect, it } from 'vitest';
import {
  byRoute,
  comparisonTabs,
  countryTallies,
  reviewOrder,
  versionTab,
} from '../src/knowledge/review-order.js';

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

describe('byRoute', () => {
  it('keeps each route together, in the order the routes first appear', () => {
    const routes = byRoute([
      { routeId: 'pt-d7', title: 'D7', number: 6 },
      { routeId: 'pt-d8', title: 'D8', number: 6 },
      { routeId: 'pt-d7', title: 'D7', number: 5 },
    ]);
    expect(routes.map(({ routeId, title, versions }) => [routeId, title, versions.length])).toEqual(
      [
        ['pt-d7', 'D7', 2],
        ['pt-d8', 'D8', 1],
      ],
    );
  });

  it('answers nothing for no versions', () => {
    expect(byRoute([])).toEqual([]);
  });
});

describe('versionTab', () => {
  it('lists proposed and active versions in use under their state', () => {
    expect(versionTab({ state: 'proposed', superseded: false })).toBe('proposed');
    expect(versionTab({ state: 'active', superseded: false })).toBe('active');
    expect(versionTab({ state: 'active' })).toBe('active');
  });

  it('lists superseded and rejected versions as previous', () => {
    expect(versionTab({ state: 'proposed', superseded: true })).toBe('previous');
    expect(versionTab({ state: 'active', superseded: true })).toBe('previous');
    expect(versionTab({ state: 'rejected', superseded: true })).toBe('previous');
    expect(versionTab({ state: 'rejected' })).toBe('previous');
  });
});

describe('comparisonTabs', () => {
  it('lists only the newest active version of a comparison as active', () => {
    const versions = [
      { comparisonId: 'destinations', number: 3, state: 'proposed' as const },
      { comparisonId: 'destinations', number: 2, state: 'active' as const },
      { comparisonId: 'destinations', number: 1, state: 'active' as const },
      { comparisonId: 'other', number: 1, state: 'rejected' as const },
    ];
    expect([...comparisonTabs(versions).values()]).toEqual([
      'proposed',
      'active',
      'previous',
      'previous',
    ]);
  });
});

describe('countryTallies', () => {
  const names: Record<string, string> = { LT: 'Lituânia', PT: 'Portugal', US: 'Estados Unidos' };
  const name = (country: string) => names[country] ?? country;

  it('counts each list and the waiting requests per country, in name order', () => {
    const tallies = countryTallies(
      [
        { country: 'PT', state: 'active', superseded: false },
        { country: 'PT', state: 'active', superseded: true },
        { country: 'US', state: 'proposed', superseded: false },
        { country: 'US', state: 'proposed', superseded: true },
        { country: 'US', state: 'rejected', superseded: true },
      ],
      [
        { country: 'US', waiting: true },
        { country: 'US', waiting: false },
        { country: 'LT', waiting: false },
      ],
      name,
    );
    expect(tallies).toEqual([
      { country: 'US', proposed: 1, active: 0, previous: 2, waiting: 1 },
      { country: 'LT', proposed: 0, active: 0, previous: 0, waiting: 0 },
      { country: 'PT', proposed: 0, active: 1, previous: 1, waiting: 0 },
    ]);
  });
});
