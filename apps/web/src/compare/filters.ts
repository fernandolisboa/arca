import { matchesSearch } from '../forms/country-search.js';

/** Which countries the list shows by their final score. */
export const scoreFilters = ['all', 'scored', 'unscored'] as const;
export type ScoreFilter = (typeof scoreFilters)[number];

export interface CountryFilter {
  readonly search: string;
  readonly score: ScoreFilter;
}

export const noFilter: CountryFilter = { search: '', score: 'all' };

/** Whether a country, by its shown name and final score, passes what the person filtered by. */
export function passesFilter(
  { name, total }: { readonly name: string; readonly total: string | null },
  { search, score }: CountryFilter,
): boolean {
  if (score === 'scored' && total === null) return false;
  if (score === 'unscored' && total !== null) return false;
  return matchesSearch(name, search);
}
