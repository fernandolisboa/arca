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
