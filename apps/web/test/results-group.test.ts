import type { RouteResult } from '@arca/api-contract/client';
import { describe, expect, it } from 'vitest';
import { anchorCountry, resultRows, resultsAnchor, rowMatches } from '../src/results/group.js';

const result = (
  routeId: string,
  principalId: string,
  route: RouteResult['route'],
  status: RouteResult['status'] = 'missing_information',
): RouteResult => ({
  routeId,
  principalId,
  status: route === null ? 'pending_activation' : status,
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
  totals: [],
  closureSources: [],
  missingRates: [],
  missingDates: [],
});

const names: Record<string, string> = {
  IS: 'Islândia',
  PT: 'Portugal',
  US: 'Estados Unidos',
  ZZ: 'Zzz',
};
const name = (code: string) => names[code] ?? code;
const route = (title: string, country: string) => ({ title, original: null, country });

describe('resultRows (spec 0007, R6)', () => {
  it('puts the routes someone may take first, then by country and title', () => {
    const { rows } = resultRows(
      [
        result('us-eb5', 'a', route('EB-5', 'US'), 'not_eligible'),
        result('pt-d8', 'a', route('Visto D8', 'PT')),
        result('pt-d7', 'a', route('Visto D7', 'PT')),
        result('us-eb5', 'b', route('EB-5', 'US'), 'eligible'),
        result('pt-d7', 'b', route('Visto D7', 'PT'), 'not_eligible'),
      ],
      name,
      'pt-BR',
    );
    expect(rows.map(({ routeId, best }) => [routeId, best])).toEqual([
      ['us-eb5', 'eligible'],
      ['pt-d7', 'missing_information'],
      ['pt-d8', 'missing_information'],
    ]);
    expect(rows[0]?.results.map(({ principalId }) => principalId)).toEqual(['a', 'b']);
  });

  it('counts a route with no active version under its country and never gives it a row', () => {
    const { rows, unnamed } = resultRows(
      [
        result('is-remote-work', 'a', null),
        result('is-remote-work', 'b', null),
        result('zz-other', 'a', null),
        result('pt-d7', 'a', route('Visto D7', 'PT')),
      ],
      name,
      'pt-BR',
    );
    expect(rows.map(({ routeId }) => routeId)).toEqual(['pt-d7']);
    expect(unnamed).toEqual([
      { country: 'IS', count: 1 },
      { country: 'ZZ', count: 1 },
    ]);
  });

  it('finds a row by its country or its title', () => {
    const [row] = resultRows([result('us-eb5', 'a', route('EB-5', 'US'))], name, 'pt-BR').rows;
    if (row === undefined) throw new Error('no row');
    expect(rowMatches(row, 'estados', name)).toBe(true);
    expect(rowMatches(row, 'eb-5', name)).toBe(true);
    expect(rowMatches(row, 'portugal', name)).toBe(false);
    expect(rowMatches(row, '', name)).toBe(true);
  });

  it('reads back the country of its own anchor only', () => {
    expect(anchorCountry(resultsAnchor('PT'))).toBe('PT');
    expect(anchorCountry('perguntas')).toBeUndefined();
  });
});
