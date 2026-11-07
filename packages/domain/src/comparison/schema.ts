import { z } from 'zod';
import { countryCodeSchema } from '../case/snapshot.js';
import { decimalSchema } from '../money/decimal.js';
import { slugSchema } from '../rules/expression.js';
import {
  knowledgeTextSchema as text,
  pinSchema,
  sourceSchema,
  versionNumberSchema as number,
} from '../rules/route-version.js';

/** A token value of a category indicator, such as `allowed`. */
export const indicatorTokenSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);

/** A weight from 0 (left out of the total) to 5 (most important). */
export const weightSchema = z.number().int().min(0).max(5);

/** The ID of a criterion a person created, which a knowledge criterion can never take. */
export const ownCriterionIdSchema = z.string().regex(/^own-[0-9a-f]{8}$/);

/** A knowledge criterion's ID: a slug that later versions keep, never in the `own-` namespace. */
export const criterionIdSchema = slugSchema.refine((id) => !id.startsWith('own-'), {
  message: 'The own- prefix is for criteria a person creates',
});

/** One measured fact for many countries, such as the homicide rate (ADR-0026). */
export const countryIndicatorSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: slugSchema,
  number,
  title: text,
  /** What a value measures, such as "per 100,000 people". */
  unit: text,
  valueType: z.enum(['decimal', 'token']),
  sources: z.array(sourceSchema).min(1).max(20),
  values: z
    .array(
      z.strictObject({
        country: countryCodeSchema,
        /** A decimal string for `decimal`, a token for `token`; checked against `valueType`. */
        value: z.string().min(1).max(40),
        year: z.number().int().min(1900).max(2200),
        source: slugSchema,
      }),
    )
    .max(300),
  countries: pinSchema,
  officialDomains: z.array(pinSchema).min(1).max(10),
});

export type CountryIndicator = z.infer<typeof countryIndicatorSchema>;

const criterionBase = {
  id: criterionIdSchema,
  title: text,
  defaultWeight: weightSchema,
};

/**
 * A criterion of a comparison version. The kinds are code and the criteria are data: `indicator`
 * scores a decimal value linearly between the value that scores 0 and the one that scores 10, so
 * the anchors also say which direction is better; `category` scores each token of a token
 * indicator; `personal` is scored from the person's own rating.
 */
export const comparisonCriterionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...criterionBase,
    kind: z.literal('indicator'),
    indicator: slugSchema,
    zeroAt: decimalSchema,
    tenAt: decimalSchema,
  }),
  z.strictObject({
    ...criterionBase,
    kind: z.literal('category'),
    indicator: slugSchema,
    scores: z
      .array(
        z.strictObject({ token: indicatorTokenSchema, score: z.number().int().min(0).max(10) }),
      )
      .min(1)
      .max(20),
  }),
  z.strictObject({ ...criterionBase, kind: z.literal('personal') }),
]);

export type ComparisonCriterion = z.infer<typeof comparisonCriterionSchema>;

/** The criteria of the destination comparison and the indicator versions they read (ADR-0026). */
export const comparisonVersionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: slugSchema,
  number,
  title: text,
  indicators: z.array(pinSchema).max(20),
  criteria: z.array(comparisonCriterionSchema).min(1).max(50),
});

export type ComparisonVersion = z.infer<typeof comparisonVersionSchema>;

export const maxOwnCriteria = 30;
export const maxRatings = 2000;
/** Keys a weights or ratings record may hold: a version's 50 criteria and 30 own ones, with room. */
export const maxCriterionKeys = 100;

/** A person's own criterion, named by them; case data, never logged and never sent to a model. */
export const ownCriterionSchema = z.strictObject({
  id: ownCriterionIdSchema,
  name: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .refine((name) => !/[\p{Cc}\p{Cf}]/u.test(name), {
      message: 'A name has no control or invisible characters',
    })
    .refine((name) => name === name.normalize('NFC'), { message: 'A name is in NFC' }),
});

const anyCriterionId = z.union([criterionIdSchema, ownCriterionIdSchema]);

/**
 * A person's comparison preferences (ADR-0026): weights by criterion, ratings from 1 to 5 stars by
 * criterion and country, their own criteria, and the countries they hid. Entries for a criterion
 * the active version no longer has are kept and ignored.
 */
export const comparisonPreferencesSchema = z
  .strictObject({
    weights: z
      .record(anyCriterionId, weightSchema)
      .refine((weights) => Object.keys(weights).length <= maxCriterionKeys, {
        message: `At most ${String(maxCriterionKeys)} weights`,
      }),
    ratings: z
      .record(
        anyCriterionId,
        z
          .record(countryCodeSchema, z.number().int().min(1).max(5))
          .refine((byCountry) => Object.keys(byCountry).length > 0, {
            message: 'A criterion with no ratings is left out',
          }),
      )
      .refine((ratings) => Object.keys(ratings).length <= maxCriterionKeys, {
        message: `At most ${String(maxCriterionKeys)} rated criteria`,
      }),
    ownCriteria: z.array(ownCriterionSchema).max(maxOwnCriteria),
    hidden: z.array(countryCodeSchema).max(300),
  })
  .superRefine((preferences, context) => {
    const ids = preferences.ownCriteria.map((criterion) => criterion.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: ['ownCriteria'], message: 'IDs are unique' });
    }
    if (new Set(preferences.hidden).size !== preferences.hidden.length) {
      context.addIssue({ code: 'custom', path: ['hidden'], message: 'Countries are unique' });
    }
    const ratings = Object.values(preferences.ratings).reduce(
      (count, byCountry) => count + Object.keys(byCountry).length,
      0,
    );
    if (ratings > maxRatings) {
      context.addIssue({
        code: 'custom',
        path: ['ratings'],
        message: `At most ${String(maxRatings)} ratings`,
      });
    }
  });

export type ComparisonPreferences = z.infer<typeof comparisonPreferencesSchema>;

/** The preferences of someone who has not chosen anything yet. */
export const noPreferences: ComparisonPreferences = {
  weights: {},
  ratings: {},
  ownCriteria: [],
  hidden: [],
};
