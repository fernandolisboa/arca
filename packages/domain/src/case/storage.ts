import { z } from 'zod';
import {
  assetFieldsSchema,
  completenessMarkers,
  coupleEdgeSchema,
  distinct,
  incomeSchema,
  maxWorkPeriods,
  parentEdgeSchema,
  periodInOrder,
  periodOrderMessage,
  personFieldsSchema,
  workPeriodFieldsSchema,
} from './snapshot.js';

/**
 * The case as the database stores it (spec 0007, R1): the snapshot's schemas with UUIDs in place
 * of opaque IDs and without the fields that point from one person to another, which are rows of
 * their own. The API validates every write with these; the snapshot builder turns rows back into
 * a `CaseSnapshot` the engine reads.
 */

export const storedIdSchema = z.uuid();

/** A name the family uses for a person: shown to the case's members, never sent to a model. */
export const displayNameSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((name) => name === name.trim(), { message: 'A name has no outer spaces' });

/**
 * A work period as the profile stores it: with an optional label that tells jobs apart on screen,
 * which stays with the profile and never enters the snapshot or a model call (ADR-0036).
 */
export const storedWorkPeriodSchema = workPeriodFieldsSchema
  .extend({ label: displayNameSchema.optional() })
  .refine(periodInOrder, periodOrderMessage);

export type StoredWorkPeriod = z.infer<typeof storedWorkPeriodSchema>;

/** The completeness markers a profile holds; the assets marker is in the finances. */
export const profileMarkers = completenessMarkers.filter(
  (marker): marker is Exclude<typeof marker, 'assets'> => marker !== 'assets',
);

/** A person's facts other than incomes, dependence and the assets marker. */
export const storedProfileFactsSchema = personFieldsSchema
  .omit({ id: true, incomes: true, financiallyDependentOn: true, recordedInFull: true })
  .extend({
    workPeriods: z.array(storedWorkPeriodSchema).max(maxWorkPeriods).optional(),
    recordedInFull: z.array(z.enum(profileMarkers)).max(profileMarkers.length).optional(),
  })
  .refine((facts) => distinct(facts.recordedInFull ?? []), {
    message: 'A completeness marker is listed once',
  });

export const storedProfileSchema = z.strictObject({
  facts: storedProfileFactsSchema,
  /** Whether dependence was answered; with no `dependence` rows that answer is nobody. */
  dependenceAnswered: z.boolean(),
});

export const storedFinancesSchema = z.strictObject({
  /** Absent when unknown; `[]` when the person has none. */
  incomes: z.array(incomeSchema).max(20).optional(),
  assetsRecordedInFull: z.boolean(),
});

export const storedAssetSchema = assetFieldsSchema.omit({ id: true, owners: true });

/** A person's share of an asset: more than 0 and at most 1, with at most six decimal places. */
export const storedOwnerShareSchema = z
  .string()
  .regex(/^(?:0\.[0-9]{1,6}|1(?:\.0{1,6})?)$/)
  .refine((share) => !/^0\.0+$/.test(share), { message: 'A share is more than 0' });

export const relationshipKinds = [
  ...coupleEdgeSchema.shape.kind.options,
  parentEdgeSchema.shape.kind.value,
] as const;

const coupleDetailsSchema = coupleEdgeSchema.omit({ kind: true, people: true });
const parentDetailsSchema = parentEdgeSchema.omit({ kind: true, parent: true, child: true });

/** One relationship row. For `parent`, `from` is the parent and `to` the child. */
export const storedRelationshipSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: coupleEdgeSchema.shape.kind,
      from: storedIdSchema,
      to: storedIdSchema,
      details: coupleDetailsSchema,
    }),
    z.strictObject({
      kind: parentEdgeSchema.shape.kind,
      from: storedIdSchema,
      to: storedIdSchema,
      details: parentDetailsSchema,
    }),
  ])
  .refine((edge) => edge.from !== edge.to, {
    message: 'A relationship links two different people',
  });

export const shareScopes = ['profile', 'finances'] as const;
export const shareScopeSchema = z.enum(shareScopes);

export type StoredProfile = z.infer<typeof storedProfileSchema>;
export type StoredFinances = z.infer<typeof storedFinancesSchema>;
export type StoredAsset = z.infer<typeof storedAssetSchema>;
export type StoredRelationship = z.infer<typeof storedRelationshipSchema>;
export type ShareScope = z.infer<typeof shareScopeSchema>;
