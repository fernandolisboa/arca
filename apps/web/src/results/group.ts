import type { RouteResult } from '@arca/api-contract/client';

/** One route with its result for each member as principal. */
export interface RouteGroup {
  readonly routeId: string;
  readonly route: RouteResult['route'];
  readonly results: readonly RouteResult[];
}

/** Routes of one country; `country` is null for routes with no active version to name one. */
export interface CountryGroup {
  readonly country: string | null;
  readonly routes: readonly RouteGroup[];
}

/**
 * The results screen's layout (spec 0007, R6): routes by country, each country by its name and
 * each route by its title, with the routes no active version names last.
 */
export function groupResults(
  results: readonly RouteResult[],
  countryName: (code: string) => string,
  locale: string,
): CountryGroup[] {
  const routes = new Map<string, RouteResult[]>();
  for (const result of results) {
    routes.set(result.routeId, [...(routes.get(result.routeId) ?? []), result]);
  }
  const countries = new Map<string | null, RouteGroup[]>();
  for (const [routeId, routeResults] of routes) {
    const route = routeResults.find((result) => result.route !== null)?.route ?? null;
    const country = route?.country ?? null;
    countries.set(country, [
      ...(countries.get(country) ?? []),
      { routeId, route, results: routeResults },
    ]);
  }
  const byName = (left: string, right: string) => left.localeCompare(right, locale);
  return [...countries]
    .map(([country, groups]) => ({
      country,
      routes: groups.sort((left, right) =>
        byName(left.route?.title ?? left.routeId, right.route?.title ?? right.routeId),
      ),
    }))
    .sort((left, right) =>
      left.country === null
        ? 1
        : right.country === null
          ? -1
          : byName(countryName(left.country), countryName(right.country)),
    );
}
