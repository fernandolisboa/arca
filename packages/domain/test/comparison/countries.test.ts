import { describe, expect, it } from 'vitest';
import {
  type PersonRouteResult,
  bestRouteStatuses,
  comparedCountries,
  routeCountry,
} from '../../src/comparison/countries.js';

describe('the compared countries', () => {
  it('reads a route’s country from its ID', () => {
    expect(routeCountry('qm-fixture-route')).toBe('QM');
  });

  it('lists each country with a route once, in code order', () => {
    expect(comparedCountries(['qp-one', 'qm-two', 'qp-three'])).toEqual(['QM', 'QP']);
    expect(comparedCountries([])).toEqual([]);
  });
});

describe('the best route status beside each country', () => {
  const result = (
    routeId: string,
    principalId: string,
    status: PersonRouteResult['status'],
    dependents: readonly string[] = [],
  ): PersonRouteResult => ({ routeId, principalId, dependents, status });

  it.each<[string, readonly PersonRouteResult[], Record<string, string>]>([
    ['no results', [], {}],
    [
      'the best over the person’s routes in a country',
      [result('qm-a', 'me', 'not_eligible'), result('qm-b', 'me', 'missing_information')],
      { QM: 'missing_information' },
    ],
    [
      'a route where the person is a dependent',
      [result('qm-a', 'spouse', 'eligible', ['me'])],
      { QM: 'eligible' },
    ],
    [
      'never another person’s route',
      [result('qm-a', 'spouse', 'eligible'), result('qm-b', 'me', 'not_eligible')],
      { QM: 'not_eligible' },
    ],
    [
      'each country apart',
      [result('qm-a', 'me', 'pending_activation'), result('qp-a', 'me', 'unavailable')],
      { QM: 'pending_activation', QP: 'unavailable' },
    ],
  ])('%s', (_name, results, expected) => {
    expect(Object.fromEntries(bestRouteStatuses(results, 'me'))).toEqual(expected);
  });
});
