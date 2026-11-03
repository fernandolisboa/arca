import { z } from 'zod';
import { calendarDateSchema } from '../calendar/calendar-date.js';
import { dateValueSchema } from '../calendar/partial-date.js';
import {
  type Decimal,
  alignScales,
  decimalSchema,
  isPositiveDecimal,
  powerOfTen,
  scaledDecimal,
} from '../money/decimal.js';
import { moneySchema } from '../money/money.js';

/** An opaque identifier, never a name or a document number. */
export const personIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/**
 * A country code: ISO 3166-1 alpha-2, or ISO 3166-3 four letters for a former state. The case
 * snapshot checks the shape only; the knowledge catalog checks the code against its pinned
 * countries and former-countries versions.
 */
export const countryCodeSchema = z.string().regex(/^(?:[A-Z]{2}|[A-Z]{4})$/);

/** Something that may not have happened: a date, `"none"`, or absent when unknown. */
const dateOrNoneSchema = z.union([dateValueSchema, z.literal('none')]);

/** ISIC Rev. 4 section letters, the sector of a job offer. */
export const isicSectionSchema = z.string().regex(/^[A-U]$/);

const citizenshipSchema = z.strictObject({
  country: countryCodeSchema,
  acquired: dateValueSchema.optional(),
  lost: dateOrNoneSchema.optional(),
  basis: z
    .enum(['birth', 'descent', 'naturalization', 'marriage', 'investment', 'other'])
    .optional(),
});

const languageSchema = z.strictObject({
  /** BCP 47 primary language subtag, such as `pt` or `en`. */
  language: z.string().regex(/^[a-z]{2,3}$/),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native']),
});

const incomeSchema = z.strictObject({
  kind: z.enum(['active', 'passive']),
  monthly: moneySchema,
  sourceCountry: countryCodeSchema,
});

const immigrationEventSchema = z.strictObject({
  country: countryCodeSchema,
  kind: z.enum([
    'visa_refusal',
    'entry_refusal',
    'overstay',
    'removal',
    'visa_granted',
    'residence_granted',
  ]),
  date: dateValueSchema.optional(),
});

const jobOfferSchema = z.strictObject({
  country: countryCodeSchema,
  sector: isicSectionSchema,
  temporary: z.boolean(),
});

/** Relationships recorded in full for a person. Without one, unrecorded people may exist. */
export const completenessMarkerSchema = z.enum(['spouses', 'partners', 'children', 'parents']);

export type CompletenessMarker = z.infer<typeof completenessMarkerSchema>;

/**
 * A person: structured facts only. An absent field is unknown, never false; a present list is
 * complete, so `[]` means none (spec 0002, R3).
 */
export const personSchema = z.strictObject({
  id: personIdSchema,
  birthDate: dateValueSchema.optional(),
  citizenships: z.array(citizenshipSchema).max(10).optional(),
  residenceCountry: countryCodeSchema.optional(),
  /** ISCED 2011 level, 0 to 8. */
  educationLevel: z.number().int().min(0).max(8).optional(),
  languages: z.array(languageSchema).max(20).optional(),
  incomes: z.array(incomeSchema).max(20).optional(),
  immigrationHistory: z.array(immigrationEventSchema).max(50).optional(),
  jobOffers: z.array(jobOfferSchema).max(10).optional(),
  /** People this person depends on financially. */
  financiallyDependentOn: z.array(personIdSchema).max(20).optional(),
  studying: z.boolean().optional(),
  recordedInFull: z.array(completenessMarkerSchema).max(4).optional(),
});

const coupleEdgeSchema = z.strictObject({
  kind: z.enum(['spouse', 'partner']),
  people: z.tuple([personIdSchema, personIdSchema]),
  start: dateValueSchema.optional(),
  end: dateOrNoneSchema.optional(),
});

const parentEdgeSchema = z.strictObject({
  kind: z.literal('parent'),
  parent: personIdSchema,
  child: personIdSchema,
  parentKind: z.enum(['biological', 'adoptive']).optional(),
  custody: z.enum(['full', 'shared', 'none']).optional(),
  /** When the link began, for an adoption; a biological link has none and is always valid. */
  start: dateValueSchema.optional(),
});

export const relationshipSchema = z.discriminatedUnion('kind', [
  coupleEdgeSchema,
  parentEdgeSchema,
]);

const assetSchema = z
  .strictObject({
    id: personIdSchema,
    kind: z.enum([
      'cash',
      'investment',
      'real_estate',
      'business',
      'retirement',
      'vehicle',
      'other',
    ]),
    owners: z
      .array(z.strictObject({ person: personIdSchema, share: decimalSchema }))
      .min(1)
      .max(12),
    value: moneySchema,
    valuedAt: calendarDateSchema,
    liquid: z.boolean().optional(),
    sold: dateOrNoneSchema.optional(),
  })
  .refine((asset) => asset.value.amount >= 0, { message: 'An asset value is not negative' })
  .refine((asset) => validShares(asset.owners), {
    message: 'Owners are distinct, each share is positive and the shares add up to at most 1',
  });

function validShares(owners: readonly { person: string; share: string }[]): boolean {
  if (new Set(owners.map((owner) => owner.person)).size !== owners.length) return false;
  if (!owners.every((owner) => isPositiveDecimal(owner.share))) return false;
  const total = owners.reduce(
    (sum, owner) => {
      const [a, b, scale] = alignScales(sum, scaledDecimal(owner.share as Decimal));
      return { units: a + b, scale };
    },
    { units: 0n, scale: 0 },
  );
  return total.units <= powerOfTen(total.scale);
}

/**
 * The engine's only view of a case. It holds no free text, names or document numbers, so it
 * cannot carry instructions; objects are strict.
 */
export const caseSnapshotSchema = z
  .strictObject({
    /** Case members; `people` may also hold others, such as grandparents. */
    members: z.array(personIdSchema).min(1).max(30),
    people: z.array(personSchema).min(1).max(60),
    relationships: z.array(relationshipSchema).max(200),
    assets: z.array(assetSchema).max(100),
  })
  .superRefine((snapshot, context) => {
    const ids = snapshot.people.map((person) => person.id);
    const known = new Set(ids);
    const issue = (message: string): void => {
      context.addIssue({ code: 'custom', message });
    };
    if (known.size !== ids.length) issue('Person IDs must be unique');
    const references = [
      ...snapshot.members,
      ...snapshot.people.flatMap((person) => person.financiallyDependentOn ?? []),
      ...snapshot.relationships.flatMap((edge) =>
        edge.kind === 'parent' ? [edge.parent, edge.child] : edge.people,
      ),
      ...snapshot.assets.flatMap((asset) => asset.owners.map((owner) => owner.person)),
    ];
    if (references.some((id) => !known.has(id)))
      issue('Every referenced person must be in `people`');
    if (
      snapshot.relationships.some((edge) =>
        edge.kind === 'parent' ? edge.parent === edge.child : edge.people[0] === edge.people[1],
      )
    ) {
      issue('A relationship links two different people');
    }
    if (new Set(snapshot.assets.map((asset) => asset.id)).size !== snapshot.assets.length) {
      issue('Asset IDs must be unique');
    }
  });

export type CaseSnapshot = z.infer<typeof caseSnapshotSchema>;
export type Person = z.infer<typeof personSchema>;
export type Relationship = z.infer<typeof relationshipSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Citizenship = z.infer<typeof citizenshipSchema>;
export type CountryCode = z.infer<typeof countryCodeSchema>;
