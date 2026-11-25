import { z } from 'zod';
import { countryCodeSchema } from '../case/snapshot.js';
import { slugSchema } from '../rules/expression.js';
import { type Source, plainSourceSchema, versionNumberSchema } from '../rules/route-version.js';
import { plainName } from './names.js';

/**
 * Stars the comparison suggests for one criterion in one country (ADR-0035), with the measured value
 * behind them: a decimal string, or a token such as `es`, which the screen words.
 */
export const suggestedRatingSchema = z.strictObject({
  country: countryCodeSchema,
  stars: z.number().int().min(1).max(5),
  value: z.string().regex(/^(?:-?\d{1,9}(?:\.\d{1,3})?|[a-z][a-z-]{0,19})$/),
  year: z.number().int().min(1900).max(2200).optional(),
  source: slugSchema,
});

/**
 * The suggested ratings: per suggestion key (a personal criterion's ID or a ready suggestion's ID),
 * the stars each country gets from a public source. Reviewed data, generated once in a pull request
 * and never by a model at run time (ADR-0035).
 */
export const suggestedRatingsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    number: versionNumberSchema,
    sources: z.array(plainSourceSchema).min(1).max(60),
    criteria: z
      .array(
        z.strictObject({
          id: slugSchema,
          ratings: z.array(suggestedRatingSchema).min(1).max(300),
        }),
      )
      .min(1)
      .max(50),
  })
  .superRefine((file, context) => {
    refineRatingFile(file, ({ country }) => country, 'country', context);
  });

export type SuggestedRatings = z.infer<typeof suggestedRatingsSchema>;

/** What the comparison suggests for one criterion in one country, and where it comes from. */
export interface SuggestedRating {
  /** The suggestion key, which the screen words the value by. */
  readonly key: string;
  readonly stars: number;
  readonly value: string;
  readonly year?: number;
  readonly source: Source;
}

/** Finds a criterion's suggestions by its suggestion key. */
export interface RatingSuggestions {
  /** The suggestion key of a criterion: its own ID, or the key its name matches. */
  keyOf(criterion: { readonly id: string; readonly name?: string }): string | undefined;
  rating(key: string, country: string): SuggestedRating | undefined;
}

/**
 * The suggestions of a ratings file. A personal criterion finds its suggestions by ID; a criterion
 * the person created finds them only when its name matches the name the screen gives a key
 * (compared like `plainName`), so a renamed criterion stops being suggested. The names are the
 * interface's, never sent anywhere; nothing here reads a model.
 */
export function ratingSuggestions(
  file: SuggestedRatings,
  namesByKey: Readonly<Record<string, string>>,
): RatingSuggestions {
  const lookup = ratingLookup(file, ({ country }) => country);
  const keyByName = new Map(
    Object.entries(namesByKey)
      .filter(([key]) => lookup.has(key))
      .map(([key, name]) => [plainName(name), key]),
  );
  return {
    keyOf: ({ id, name }) => {
      if (name !== undefined) return keyByName.get(plainName(name));
      return lookup.has(id) ? id : undefined;
    },
    rating: lookup.rating,
  };
}

/** No suggestions at all. */
export const noRatingSuggestions: RatingSuggestions = {
  keyOf: () => undefined,
  rating: () => undefined,
};

interface FileRating {
  readonly stars: number;
  readonly value: string;
  readonly year?: number | undefined;
  readonly source: string;
}

interface RatingFile<R extends FileRating> {
  readonly sources: readonly Source[];
  readonly criteria: readonly { readonly id: string; readonly ratings: readonly R[] }[];
}

/**
 * The checks a ratings file shares with a regions file (ADR-0042): unique source and criterion IDs,
 * one rating per place on each key, and every rating's source listed.
 */
export function refineRatingFile<R extends FileRating>(
  file: RatingFile<R>,
  placeOf: (rating: R) => string,
  unit: 'country' | 'region',
  context: z.RefinementCtx,
): void {
  const sources = new Set(file.sources.map(({ id }) => id));
  if (sources.size !== file.sources.length) {
    context.addIssue({ code: 'custom', path: ['sources'], message: 'Source IDs are unique' });
  }
  if (new Set(file.criteria.map(({ id }) => id)).size !== file.criteria.length) {
    context.addIssue({ code: 'custom', path: ['criteria'], message: 'Criterion IDs are unique' });
  }
  file.criteria.forEach(({ ratings }, index) => {
    if (new Set(ratings.map(placeOf)).size !== ratings.length) {
      context.addIssue({
        code: 'custom',
        path: ['criteria', index, 'ratings'],
        message: `One rating per ${unit}`,
      });
    }
    ratings.forEach(({ source }, at) => {
      if (!sources.has(source)) {
        context.addIssue({
          code: 'custom',
          path: ['criteria', index, 'ratings', at, 'source'],
          message: 'The source is listed',
        });
      }
    });
  });
}

/** A ratings file's stars by suggestion key and place, each with its source. */
export interface RatingLookup {
  readonly has: (key: string) => boolean;
  readonly rating: (key: string, place: string) => SuggestedRating | undefined;
}

export function ratingLookup<R extends FileRating>(
  file: RatingFile<R>,
  placeOf: (rating: R) => string,
): RatingLookup {
  const sources = new Map(file.sources.map((source) => [source.id, source]));
  const byKey = new Map(
    file.criteria.map(({ id, ratings }) => [
      id,
      new Map(ratings.map((rating) => [placeOf(rating), rating])),
    ]),
  );
  return {
    has: (key) => byKey.has(key),
    rating: (key, place) => {
      const found = byKey.get(key)?.get(place);
      const source = found === undefined ? undefined : sources.get(found.source);
      if (found === undefined || source === undefined) return undefined;
      return {
        key,
        stars: found.stars,
        value: found.value,
        ...(found.year === undefined ? {} : { year: found.year }),
        source,
      };
    },
  };
}
