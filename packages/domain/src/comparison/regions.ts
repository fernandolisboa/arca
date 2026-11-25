import { z } from 'zod';
import { countryCodeSchema } from '../case/snapshot.js';
import { slugSchema } from '../rules/expression.js';
import { plainSourceSchema, versionNumberSchema } from '../rules/route-version.js';
import { type SuggestedRating, suggestedRatingSchema } from './suggested.js';

/** A region inside a country: its ISO 3166-2 subdivision code, such as `PT-20` or `US-TX`. */
export const regionCodeSchema = z.string().regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/);

/** A country or one of its regions: what the comparison scores and a person rates. */
export const placeCodeSchema = z.union([countryCodeSchema, regionCodeSchema]);

/** The country a region code belongs to. */
export const regionCountry = (region: string) => region.slice(0, 2);

const regionRatingSchema = suggestedRatingSchema
  .omit({ country: true })
  .extend({ region: regionCodeSchema });

/**
 * The regions of the comparison and their suggested stars (ADR-0042): per suggestion key, the stars
 * each region gets from a public source, on the same bands as a country's (ADR-0035). Reviewed
 * data, generated once in a pull request and never by a model at run time. A region with no value
 * on a key takes its country's score.
 */
export const regionRatingsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    number: versionNumberSchema,
    sources: z.array(plainSourceSchema).min(1).max(80),
    regions: z.array(regionCodeSchema).min(1).max(300),
    criteria: z
      .array(
        z.strictObject({
          id: slugSchema,
          ratings: z.array(regionRatingSchema).min(1).max(300),
        }),
      )
      .min(1)
      .max(50),
  })
  .superRefine((file, context) => {
    const sources = new Set(file.sources.map(({ id }) => id));
    const regions = new Set(file.regions);
    if (sources.size !== file.sources.length) {
      context.addIssue({ code: 'custom', path: ['sources'], message: 'Source IDs are unique' });
    }
    if (regions.size !== file.regions.length) {
      context.addIssue({ code: 'custom', path: ['regions'], message: 'Regions are unique' });
    }
    if (new Set(file.criteria.map(({ id }) => id)).size !== file.criteria.length) {
      context.addIssue({ code: 'custom', path: ['criteria'], message: 'Criterion IDs are unique' });
    }
    file.criteria.forEach(({ ratings }, index) => {
      if (new Set(ratings.map(({ region }) => region)).size !== ratings.length) {
        context.addIssue({
          code: 'custom',
          path: ['criteria', index, 'ratings'],
          message: 'One rating per region',
        });
      }
      ratings.forEach(({ region, source }, at) => {
        if (!regions.has(region)) {
          context.addIssue({
            code: 'custom',
            path: ['criteria', index, 'ratings', at, 'region'],
            message: 'The region is listed',
          });
        }
        if (!sources.has(source)) {
          context.addIssue({
            code: 'custom',
            path: ['criteria', index, 'ratings', at, 'source'],
            message: 'The source is listed',
          });
        }
      });
    });
  });

export type RegionRatings = z.infer<typeof regionRatingsSchema>;

/** The regions of each country and what their data suggests, by suggestion key. */
export interface RegionSuggestions {
  /** A country's regions in code order; none when the data has none. */
  regionsOf(country: string): readonly string[];
  rating(key: string, region: string): SuggestedRating | undefined;
}

/** The region suggestions of a regions file. Nothing here reads a model. */
export function regionSuggestions(file: RegionRatings): RegionSuggestions {
  const sources = new Map(file.sources.map((source) => [source.id, source]));
  const byKey = new Map(
    file.criteria.map(({ id, ratings }) => [
      id,
      new Map(ratings.map((rating) => [rating.region, rating])),
    ]),
  );
  const byCountry = Map.groupBy([...file.regions].sort(), regionCountry);
  return {
    regionsOf: (country) => byCountry.get(country) ?? [],
    rating: (key, region) => {
      const found = byKey.get(key)?.get(region);
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

/** No regions at all. */
export const noRegionSuggestions: RegionSuggestions = {
  regionsOf: () => [],
  rating: () => undefined,
};
