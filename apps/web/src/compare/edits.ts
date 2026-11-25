import {
  maxDismissedSuggestions,
  type WriteComparisonPreferencesRequest,
} from '@arca/api-contract/client';

export type Preferences = WriteComparisonPreferencesRequest;

/** One change a person makes on the comparison screen; the API recomputes everything else. */
export type Edit =
  | { readonly kind: 'weight'; readonly criterion: string; readonly weight: number }
  | {
      readonly kind: 'rating';
      readonly criterion: string;
      /** A country or one of its regions (ADR-0042). */
      readonly place: string;
      /** Undefined takes the rating away. */
      readonly rating: number | undefined;
    }
  | { readonly kind: 'hide' | 'show'; readonly country: string }
  | {
      readonly kind: 'add';
      readonly name: string;
      /** The weight it starts at, as a suggestion proposes; without one, the API's default. */
      readonly weight?: number;
    }
  /** Takes back a criterion just added from a suggestion, found by its name. */
  | { readonly kind: 'unadd'; readonly name: string }
  | { readonly kind: 'dismiss' | 'undismiss'; readonly name: string }
  | { readonly kind: 'rename'; readonly criterion: string; readonly name: string }
  | { readonly kind: 'remove'; readonly criterion: string };

/** The person's stars for a criterion in a place; undefined takes them away. */
export const ratingEdit = (criterion: string, place: string, rating: number | undefined): Edit => ({
  kind: 'rating',
  criterion,
  place,
  rating,
});

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([each]) => each !== key));
}

function rated(preferences: Preferences, edit: Extract<Edit, { kind: 'rating' }>): Preferences {
  const byPlace = without(preferences.ratings[edit.criterion] ?? {}, edit.place);
  if (edit.rating !== undefined) byPlace[edit.place] = edit.rating;
  const ratings = without(preferences.ratings, edit.criterion);
  // The API refuses a criterion with no ratings left, so its key goes with the last one.
  if (Object.keys(byPlace).length > 0) ratings[edit.criterion] = byPlace;
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
      return {
        ...preferences,
        ownCriteria: [
          ...preferences.ownCriteria,
          { name: edit.name, ...(edit.weight === undefined ? {} : { weight: edit.weight }) },
        ],
      };
    case 'unadd': {
      const added = preferences.ownCriteria.findLast((own) => own.name === edit.name);
      if (added === undefined) return preferences;
      if (added.id !== undefined)
        return applyEdit(preferences, { kind: 'remove', criterion: added.id });
      return {
        ...preferences,
        ownCriteria: preferences.ownCriteria.filter((own) => own !== added),
      };
    }
    case 'dismiss':
      // At the cap, the oldest turned-down name makes room, so every later write still saves.
      return preferences.dismissed.includes(edit.name)
        ? preferences
        : {
            ...preferences,
            dismissed: [...preferences.dismissed, edit.name].slice(-maxDismissedSuggestions),
          };
    case 'undismiss':
      return {
        ...preferences,
        dismissed: preferences.dismissed.filter((each) => each !== edit.name),
      };
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
        dismissed: preferences.dismissed,
      };
  }
}
