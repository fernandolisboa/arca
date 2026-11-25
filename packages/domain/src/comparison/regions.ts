import { z } from 'zod';
import { countryCodeSchema } from '../case/snapshot.js';
import { slugSchema } from '../rules/expression.js';
import { plainSourceSchema, versionNumberSchema } from '../rules/route-version.js';
import {
  type SuggestedRating,
  ratingLookup,
  refineRatingFile,
  suggestedRatingSchema,
} from './suggested.js';

/** A region inside a country: its ISO 3166-2 subdivision code, such as `PT-20` or `US-TX`. */
export const regionCodeSchema = z.string().regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/);

/** A country or one of its regions: what the comparison scores and a person rates. */
export const placeCodeSchema = z.union([countryCodeSchema, regionCodeSchema]);

/** The most regions a country may have, which the comparison's answer also caps. */
export const maxRegionsPerCountry = 100;

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
    refineRatingFile(file, ({ region }) => region, 'region', context);
    const regions = new Set(file.regions);
    if (regions.size !== file.regions.length) {
      context.addIssue({ code: 'custom', path: ['regions'], message: 'Regions are unique' });
    }
    for (const [country, each] of Map.groupBy(regions, regionCountry)) {
      if (each.length > maxRegionsPerCountry) {
        context.addIssue({
          code: 'custom',
          path: ['regions'],
          message: `At most ${String(maxRegionsPerCountry)} regions in ${country}`,
        });
      }
    }
    file.criteria.forEach(({ ratings }, index) => {
      ratings.forEach(({ region }, at) => {
        if (!regions.has(region)) {
          context.addIssue({
            code: 'custom',
            path: ['criteria', index, 'ratings', at, 'region'],
            message: 'The region is listed',
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
  const byCountry = Map.groupBy([...file.regions].sort(), regionCountry);
  return {
    regionsOf: (country) => byCountry.get(country) ?? [],
    rating: ratingLookup(file, ({ region }) => region).rating,
  };
}

export const noRegionSuggestions: RegionSuggestions = {
  regionsOf: () => [],
  rating: () => undefined,
};
