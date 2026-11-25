import {
  type RouteResult,
  bestRouteStatus,
  routeCountry,
  routeStatusOrder,
} from '@arca/api-contract/client';
import { matchesSearch } from '@arca/ui';

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

/** A route and a member as principal: what the detail panel shows. */
export interface Selection {
  readonly routeId: string;
  readonly principalId: string;
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
    const best = bestRouteStatus(routeResults.map((result) => result.status));
    if (best === undefined) continue;
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

/**
 * The route the detail shows: the one chosen while it is still listed; before any choice, the
 * linked country's first route; on a wide screen, else the first row. `null` is a closed card.
 */
export function selectedRoute(
  shown: readonly RouteRow[],
  chosen: Selection | null | undefined,
  linkedCountry: string | undefined,
  wide: boolean,
): Selection | undefined {
  if (chosen != null && shown.some(({ routeId }) => routeId === chosen.routeId)) return chosen;
  const linked =
    chosen === undefined ? shown.find(({ route }) => route.country === linkedCountry) : undefined;
  const first = (linked ?? (wide ? shown[0] : undefined))?.results[0];
  return first === undefined
    ? undefined
    : { routeId: first.routeId, principalId: first.principalId };
}
