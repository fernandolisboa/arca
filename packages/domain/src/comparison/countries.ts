import { type RouteStatus, bestRouteStatus } from '../case/results.js';

/** A route's country, from its ID alone: the catalog build refuses an ID that does not start with it. */
export function routeCountry(routeId: string): string {
  return routeId.slice(0, 2).toUpperCase();
}

/** The countries the comparison shows: those with at least one route, in code order. */
export function comparedCountries(routeIds: readonly string[]): string[] {
  return [...new Set(routeIds.map(routeCountry))].sort();
}

/** The parts of a route result the route status beside a country reads. */
export interface PersonRouteResult {
  readonly routeId: string;
  readonly principalId: string;
  readonly dependents: readonly string[];
  readonly status: RouteStatus;
}

/**
 * The best route status a person has in each country, over every route where they are the
 * principal or a dependent. A country with no such route is absent. It sits beside the score and
 * never changes it.
 */
export function bestRouteStatuses(
  results: readonly PersonRouteResult[],
  personId: string,
): ReadonlyMap<string, RouteStatus> {
  const byCountry = new Map<string, RouteStatus[]>();
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
