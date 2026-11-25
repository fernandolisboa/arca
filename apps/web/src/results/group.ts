import { type RouteResult, routeCountry, routeStatusOrder } from '@arca/api-contract/client';
import { matchesSearch } from '../forms/country-search.js';

type Status = RouteResult['status'];
type NamedRoute = NonNullable<RouteResult['route']>;

/** One route with its result for each member as principal, as a row of the results table. */
export interface RouteRow {
  readonly routeId: string;
  readonly route: NamedRoute;
  readonly results: readonly RouteResult[];
  /** The best status any member has on it, which orders the rows. */
  readonly best: Status;
}

/** How many routes of a country have no active version to name them (CLAUDE.md rule 5). */
export interface UnnamedRoutes {
  readonly country: string;
  readonly count: number;
}

export interface ResultRows {
  readonly rows: readonly RouteRow[];
  readonly unnamed: readonly UnnamedRoutes[];
}

const rank = (status: Status) => routeStatusOrder.indexOf(status);

/**
 * The results screen's rows: a route per row, the routes someone may take first, then by country
 * and title. A route no active version names gets no row, only a count under its country, so its
 * ID never reaches a member.
 */
export function resultRows(
  results: readonly RouteResult[],
  countryName: (code: string) => string,
  locale: string,
): ResultRows {
  const byRoute = Map.groupBy(results, (result) => result.routeId);
  const rows: RouteRow[] = [];
  const unnamed = new Map<string, number>();
  for (const [routeId, routeResults] of byRoute) {
    const route = routeResults.find((result) => result.route !== null)?.route ?? null;
    if (route === null) {
      const country = routeCountry(routeId);
      unnamed.set(country, (unnamed.get(country) ?? 0) + 1);
      continue;
    }
    const best = routeResults
      .map((result) => result.status)
      .reduce((left, right) => (rank(right) < rank(left) ? right : left));
    rows.push({ routeId, route, results: routeResults, best });
  }
  const byName = (left: string, right: string) => left.localeCompare(right, locale);
  return {
    rows: rows.sort(
      (left, right) =>
        rank(left.best) - rank(right.best) ||
        byName(countryName(left.route.country), countryName(right.route.country)) ||
        byName(left.route.title, right.route.title),
    ),
    unnamed: [...unnamed]
      .map(([country, count]) => ({ country, count }))
      .sort((left, right) => byName(countryName(left.country), countryName(right.country))),
  };
}

/** Whether a row answers the search, by its country's name or its title. */
export function rowMatches(
  row: RouteRow,
  search: string,
  countryName: (code: string) => string,
): boolean {
  return (
    matchesSearch(countryName(row.route.country), search) || matchesSearch(row.route.title, search)
  );
}

/** The results screen's anchor for one country, so another screen can link to it. */
export const resultsAnchor = (country: string) => `country-${country.toLowerCase()}`;

/** The country a results anchor names, or undefined for any other hash. */
export const anchorCountry = (hash: string) =>
  /^country-([a-z]{2})$/u.exec(hash)?.[1]?.toUpperCase();
