import { newlyNamed } from '@arca/api-contract/client';

/** A criterion the screen proposes, with the weight it would start at. */
export interface Suggestion {
  readonly name: string;
  readonly weight: number;
}

/**
 * Ready suggestions by ID, each named in the catalog under `compare.suggestion.<id>`: country
 * traits that matter when a family chooses where to move, beyond the comparison's own criteria.
 */
export const readySuggestions = [
  { id: 'citizenship-time', weight: 4 },
  { id: 'dual-citizenship', weight: 4 },
  { id: 'housing-cost', weight: 4 },
  { id: 'diploma-recognition', weight: 3 },
  { id: 'welcome-to-immigrants', weight: 3 },
  { id: 'stability', weight: 3 },
  { id: 'direct-flight', weight: 2 },
  { id: 'time-zone', weight: 2 },
  { id: 'public-transport', weight: 2 },
  { id: 'public-university', weight: 2 },
  { id: 'banking', weight: 2 },
  { id: 'outdoors', weight: 1 },
] as const;

/**
 * The suggestions still worth showing: not named like a criterion the person already has, nor
 * like one they turned down, compared without case or accents; the first of two alike stays.
 */
export function openSuggestions<Shown extends Suggestion>(
  suggestions: readonly Shown[],
  {
    taken,
    dismissed,
  }: { readonly taken: readonly string[]; readonly dismissed: readonly string[] },
): Shown[] {
  return newlyNamed(suggestions, [...taken, ...dismissed]);
}
