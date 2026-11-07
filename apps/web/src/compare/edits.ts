import type { WriteComparisonPreferencesRequest } from '@arca/api-contract/client';

export type Preferences = WriteComparisonPreferencesRequest;

/** One change a person makes on the comparison screen; the API recomputes everything else. */
export type Edit =
  | { readonly kind: 'weight'; readonly criterion: string; readonly weight: number }
  | {
      readonly kind: 'rating';
      readonly criterion: string;
      readonly country: string;
      /** Undefined takes the rating away. */
      readonly rating: number | undefined;
    }
  | { readonly kind: 'hide' | 'show'; readonly country: string }
  | { readonly kind: 'add'; readonly name: string }
  | { readonly kind: 'rename'; readonly criterion: string; readonly name: string }
  | { readonly kind: 'remove'; readonly criterion: string };

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([each]) => each !== key));
}

function rated(preferences: Preferences, edit: Extract<Edit, { kind: 'rating' }>): Preferences {
  const byCountry = without(preferences.ratings[edit.criterion] ?? {}, edit.country);
  if (edit.rating !== undefined) byCountry[edit.country] = edit.rating;
  const ratings = without(preferences.ratings, edit.criterion);
  // The API refuses a criterion with no ratings left, so its key goes with the last one.
  if (Object.keys(byCountry).length > 0) ratings[edit.criterion] = byCountry;
  return { ...preferences, ratings };
}

/**
 * The preferences after one edit. A new own criterion has no ID until the API names it, and an
 * own criterion that goes takes its weight and ratings with it, as the API does.
 */
export function applyEdit(preferences: Preferences, edit: Edit): Preferences {
  switch (edit.kind) {
    case 'weight':
      return { ...preferences, weights: { ...preferences.weights, [edit.criterion]: edit.weight } };
    case 'rating':
      return rated(preferences, edit);
    case 'hide':
      return preferences.hidden.includes(edit.country)
        ? preferences
        : { ...preferences, hidden: [...preferences.hidden, edit.country] };
    case 'show':
      return { ...preferences, hidden: preferences.hidden.filter((each) => each !== edit.country) };
    case 'add':
      return { ...preferences, ownCriteria: [...preferences.ownCriteria, { name: edit.name }] };
    case 'rename':
      return {
        ...preferences,
        ownCriteria: preferences.ownCriteria.map((own) =>
          own.id === edit.criterion ? { ...own, name: edit.name } : own,
        ),
      };
    case 'remove':
      return {
        ownCriteria: preferences.ownCriteria.filter((own) => own.id !== edit.criterion),
        weights: without(preferences.weights, edit.criterion),
        ratings: without(preferences.ratings, edit.criterion),
        hidden: preferences.hidden,
      };
  }
}
