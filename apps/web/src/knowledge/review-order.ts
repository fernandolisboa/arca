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
