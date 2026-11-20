import type { KnowledgeVersion } from '@arca/api-contract/client';

/** One country's proposed versions, in the order to review them. */
export interface CountryGroup<V> {
  readonly country: string;
  readonly versions: readonly V[];
}

/** Proposed versions grouped by country, countries and versions each in name order. */
export function reviewOrder<V extends Pick<KnowledgeVersion, 'country' | 'title'>>(
  versions: readonly V[],
  name: (country: string) => string,
): readonly CountryGroup<V>[] {
  const groups = new Map<string, V[]>();
  for (const version of versions) {
    groups.set(version.country, [...(groups.get(version.country) ?? []), version]);
  }
  return [...groups]
    .map(([country, listed]) => ({
      country,
      versions: listed.toSorted((left, right) => left.title.localeCompare(right.title)),
    }))
    .toSorted((left, right) => name(left.country).localeCompare(name(right.country)));
}

/** One route's versions inside a country. */
export interface RouteGroup<V> {
  readonly routeId: string;
  readonly title: string;
  readonly versions: readonly V[];
}

/**
 * A country's versions by route (one visa or way in), in the order the routes first appear, each
 * named by its first version's title.
 */
export function byRoute<V extends Pick<KnowledgeVersion, 'routeId' | 'title'>>(
  versions: readonly V[],
): readonly RouteGroup<V>[] {
  const routes = new Map<string, V[]>();
  for (const version of versions) {
    routes.set(version.routeId, [...(routes.get(version.routeId) ?? []), version]);
  }
  return [...routes].flatMap(([routeId, listed]) => {
    const [first] = listed;
    return first === undefined ? [] : [{ routeId, title: first.title, versions: listed }];
  });
}

/** The country of a route, from any of its versions. */
export function countryOfRoute(
  versions: readonly Pick<KnowledgeVersion, 'routeId' | 'country'>[],
  routeId: string,
): string | undefined {
  return versions.find((version) => version.routeId === routeId)?.country;
}

/** The lists the activation screen splits versions into. */
export const versionTabs = ['proposed', 'active', 'previous'] as const;
export type VersionTab = (typeof versionTabs)[number];

/**
 * Where a version is listed: a proposed or active one while some date from today on uses it, any
 * other (superseded or rejected) with the previous ones, as history.
 */
export function versionTab({
  state,
  superseded = false,
}: {
  readonly state: KnowledgeVersion['state'];
  readonly superseded?: boolean;
}): VersionTab {
  return state === 'rejected' || superseded ? 'previous' : state;
}

/** A request or report about a country, and whether it waits for an admin. */
export interface CountryRequest {
  readonly country: string;
  readonly waiting: boolean;
}

/** How many versions of each list a country has, and how many of its requests wait. */
export type CountryTally = { readonly country: string; readonly waiting: number } & Readonly<
  Record<VersionTab, number>
>;

/** Every country with a version or a request, in name order, with its counts. */
export function countryTallies(
  versions: readonly Pick<KnowledgeVersion, 'country' | 'state' | 'superseded'>[],
  requests: readonly CountryRequest[],
  name: (country: string) => string,
): readonly CountryTally[] {
  const tallies = new Map<string, { -readonly [K in keyof CountryTally]: CountryTally[K] }>();
  const tallyOf = (country: string) => {
    const known = tallies.get(country);
    if (known !== undefined) return known;
    const fresh = { country, proposed: 0, active: 0, previous: 0, waiting: 0 };
    tallies.set(country, fresh);
    return fresh;
  };
  for (const version of versions) tallyOf(version.country)[versionTab(version)] += 1;
  for (const request of requests) {
    if (request.waiting) tallyOf(request.country).waiting += 1;
    else tallyOf(request.country);
  }
  return [...tallies.values()].toSorted((left, right) =>
    name(left.country).localeCompare(name(right.country)),
  );
}
