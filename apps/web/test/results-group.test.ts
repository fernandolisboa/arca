import type { RouteResult } from '@arca/api-contract/client';
import { describe, expect, it } from 'vitest';
import { groupResults } from '../src/results/group.js';

const result = (
  routeId: string,
  principalId: string,
  route: RouteResult['route'],
): RouteResult => ({
  routeId,
  principalId,
  status: route === null ? 'pending_activation' : 'missing_information',
  route,
  version: null,
  stale: false,
  newerProposedVersion: null,
  dependents: [],
  possibleDependents: [],
  unitOpen: false,
  requirements: [],
  assessments: [],
  costs: [],
  durations: [],
});

const names: Record<string, string> = { PT: 'Portugal', US: 'Estados Unidos' };

describe('groupResults (spec 0007, R6)', () => {
  it('puts routes under their country by name, each by title, and unnamed routes last', () => {
    const d8 = { title: 'Visto D8', country: 'PT' };
    const d7 = { title: 'Visto D7', country: 'PT' };
    const eb5 = { title: 'EB-5', country: 'US' };
    const grouped = groupResults(
      [
        result('pt-d8', 'a', d8),
        result('zz-new', 'a', null),
        result('us-eb5', 'a', eb5),
        result('pt-d7', 'a', d7),
        result('pt-d8', 'b', d8),
      ],
      (code) => names[code] ?? code,
      'pt-BR',
    );
    expect(grouped.map(({ country }) => country)).toEqual(['US', 'PT', null]);
    expect(grouped[1]?.routes.map(({ routeId }) => routeId)).toEqual(['pt-d7', 'pt-d8']);
    expect(grouped[1]?.routes[1]?.results.map(({ principalId }) => principalId)).toEqual([
      'a',
      'b',
    ]);
    expect(grouped[2]?.routes[0]?.route).toBeNull();
  });
});
