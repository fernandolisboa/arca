import { type RouteResult, bestRouteStatus } from '../case/results.js';
import { routeCountry } from '../rules/route-version.js';

/** The countries the comparison shows: those with at least one route, in code order. */
export function comparedCountries(routeIds: readonly string[]): string[] {
  return [...new Set(routeIds.map(routeCountry))].sort();
}

/** The parts of a route result the route status beside a country reads. */
export type PersonRouteResult = Pick<
  RouteResult,
  'routeId' | 'principalId' | 'dependents' | 'status'
>;

/**
 * The best route status a person has in each country, over every route where they are the
 * principal or a dependent. A country with no such route is absent. It sits beside the score and
 * never changes it.
 */
export function bestRouteStatuses(
  results: readonly PersonRouteResult[],
  personId: string,
): ReadonlyMap<string, RouteResult['status']> {
  const byCountry = new Map<string, RouteResult['status'][]>();
  for (const result of results) {
    if (result.principalId !== personId && !result.dependents.includes(personId)) continue;
    const country = routeCountry(result.routeId);
    byCountry.set(country, [...(byCountry.get(country) ?? []), result.status]);
  }
  return new Map(
    [...byCountry].flatMap(([country, statuses]) => {
      const best = bestRouteStatus(statuses);
      return best === undefined ? [] : [[country, best] as const];
    }),
  );
}
