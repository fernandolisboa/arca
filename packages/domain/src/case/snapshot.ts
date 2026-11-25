import { z } from 'zod';
import { calendarDateSchema } from '../calendar/calendar-date.js';
import { type DateValue, compareDateValues, dateValueSchema } from '../calendar/partial-date.js';
import { currencyCodeSchema } from '../money/currency.js';
import {
  type Decimal,
  alignScales,
  decimalSchema,
  isPositiveDecimal,
  powerOfTen,
  scaledDecimal,
} from '../money/decimal.js';

/**
 * An opaque identifier the API assigns per snapshot: one letter and up to four digits, such as
 * `p1`. Too short to carry a name, a document number or an instruction.
 */
export const opaqueIdSchema = z.string().regex(/^[a-z][0-9]{1,4}$/);

/**
 * A country code: ISO 3166-1 alpha-2, or ISO 3166-3 four letters for a former state. The case
 * snapshot checks the shape only; the knowledge catalog checks the code against its pinned
 * countries and former-countries versions.
 */
export const countryCodeSchema = z.string().regex(/^(?:[A-Z]{2}|[A-Z]{4})$/);

export type CountryCode = z.infer<typeof countryCodeSchema>;

/** Something that may not have happened: a date, `"none"`, or absent when unknown. */
const dateOrNoneSchema = z.union([dateValueSchema, z.literal('none')]);

/** An amount that is never negative, such as an income or an asset's value. */
const nonNegativeMoneySchema = z.strictObject({
  amount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: currencyCodeSchema,
});

/** ISIC Rev. 4 section letters, the sector of a job offer. */
export const isicSections = 'ABCDEFGHIJKLMNOPQRSTU'.split('');
export const parentKinds = ['biological', 'adoptive'] as const;
export const custodies = ['full', 'shared', 'none'] as const;
export const citizenshipBases = [
  'birth',
  'descent',
  'naturalization',
  'marriage',
  'investment',
  'other',
] as const;
/** CEFR levels, and a native speaker. */
export const languageLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'] as const;
export const incomeKinds = ['active', 'passive'] as const;
export const immigrationEventKinds = [
  'visa_refusal',
  'entry_refusal',
  'overstay',
  'removal',
  'visa_granted',
  'residence_granted',
] as const;

/** Relationships, or assets, recorded in full for a person. Without one, more may exist. */
export const completenessMarkers = [
  'spouses',
  'partners',
  'children',
  'parents',
  'assets',
] as const;

export const completenessMarkerSchema = z.enum(completenessMarkers);

export type CompletenessMarker = z.infer<typeof completenessMarkerSchema>;

const citizenshipSchema = z
  .strictObject({
    country: countryCodeSchema,
    acquired: dateValueSchema.optional(),
    lost: dateOrNoneSchema.optional(),
    basis: z.enum(citizenshipBases).optional(),
  })
  .refine(
    ({ acquired, lost }) =>
      acquired === undefined ||
      lost === undefined ||
      lost === 'none' ||
      compareDateValues(lost, 'lt', acquired) !== true,
    { message: 'A citizenship is not lost before it is acquired' },
  );

const languageSchema = z.strictObject({
  /** BCP 47 primary language subtag, such as `pt` or `en`. */
  language: z.string().regex(/^[a-z]{2,3}$/),
  level: z.enum(languageLevels),
});

export const incomeSchema = z.strictObject({
  kind: z.enum(incomeKinds),
  monthly: nonNegativeMoneySchema,
  sourceCountry: countryCodeSchema,
});

const immigrationEventSchema = z.strictObject({
  country: countryCodeSchema,
  kind: z.enum(immigrationEventKinds),
  date: dateValueSchema.optional(),
});

/** An ISCO-08 unit group code; the API checks it against the occupations classification. */
export const occupationCodeSchema = z.string().regex(/^[0-9]{4}$/);

/**
 * A job offer in a country (ADR-0036). The occupation, the gross annual salary and whether the
 * employer will sponsor the application are optional, so offers recorded without them still load.
 */
const jobOfferSchema = z.strictObject({
  country: countryCodeSchema,
  sector: z.enum(isicSections),
  temporary: z.boolean(),
  occupation: occupationCodeSchema.optional(),
  annualSalary: nonNegativeMoneySchema.optional(),
  sponsored: z.boolean().optional(),
});

export type JobOffer = z.infer<typeof jobOfferSchema>;

export const workRelations = ['employee', 'contractor', 'self_employed', 'owner'] as const;
/** The role a person says they had; whether it meets a route's legal definition is an assessment. */
export const workCapacities = ['executive', 'manager', 'other'] as const;
export const maxWorkPeriods = 20;

/**
 * A work period's fields (ADR-0036): where the employer or main client is seated, where the person
 * works from, codes and dates only. `end` is `"none"` while it goes on.
 */
export const workPeriodFieldsSchema = z.strictObject({
  employerCountry: countryCodeSchema.optional(),
  workplaceCountry: countryCodeSchema.optional(),
  relation: z.enum(workRelations).optional(),
  occupation: occupationCodeSchema.optional(),
  capacity: z.enum(workCapacities).optional(),
  fullTime: z.boolean().optional(),
  start: dateValueSchema.optional(),
  end: dateOrNoneSchema.optional(),
  /** The business asset, co-owned by the person, that the work is at. */
  business: opaqueIdSchema.optional(),
});

/** A period does not end before it starts. */
export const periodInOrder = ({
  start,
  end,
}: {
  readonly start?: DateValue | undefined;
  readonly end?: DateValue | 'none' | undefined;
}): boolean =>
  start === undefined ||
  end === undefined ||
  end === 'none' ||
  compareDateValues(end, 'lt', start) !== true;

export const periodOrderMessage = { message: 'A period does not end before it starts' };

export const workPeriodSchema = workPeriodFieldsSchema.refine(periodInOrder, periodOrderMessage);

export type WorkPeriod = z.infer<typeof workPeriodSchema>;

export const maxEducationLevel = 8;

/** An ISCED 2011 level, 0 to 8. */
export const educationLevelSchema = z.number().int().min(0).max(maxEducationLevel);

/** An ISCED-F 2013 detailed field code; the API checks it against the study-fields classification. */
export const studyFieldCodeSchema = z.string().regex(/^[0-9]{4}$/);

export const maxQualifications = 20;
export const maxRegistrations = 20;

/** A qualification (ADR-0036): its level, field of study, the country that awarded it and when. */
export const qualificationSchema = z.strictObject({
  level: educationLevelSchema.optional(),
  field: studyFieldCodeSchema.optional(),
  country: countryCodeSchema.optional(),
  completed: dateValueSchema.optional(),
});

export type Qualification = z.infer<typeof qualificationSchema>;

/** A professional registration (ADR-0036): the occupation, the country it is held in, since when. */
export const registrationSchema = z.strictObject({
  country: countryCodeSchema.optional(),
  occupation: occupationCodeSchema.optional(),
  since: dateValueSchema.optional(),
});

export type Registration = z.infer<typeof registrationSchema>;

/** No qualification is above the education level, when both are known. */
export const qualificationsWithinLevel = ({
  educationLevel,
  qualifications,
}: {
  readonly educationLevel?: number | undefined;
  readonly qualifications?: readonly Qualification[] | undefined;
}): boolean =>
  educationLevel === undefined ||
  (qualifications ?? []).every(({ level }) => level === undefined || level <= educationLevel);

export const qualificationLevelMessage = {
  message: 'A qualification is not above the education level',
};
/** The legal basis a person lived in a country on; `other` covers any basis outside the three. */
export const residenceBases = [
  'citizen',
  'permanent_residence',
  'temporary_residence',
  'other',
] as const;
export const maxResidencePeriods = 30;

/**
 * A stretch of living in one country on one basis (ADR-0036). `end` is `"none"` while it goes on.
 * `residenceCountry` stays the country lived in now.
 */
export const residencePeriodSchema = z
  .strictObject({
    country: countryCodeSchema,
    basis: z.enum(residenceBases).optional(),
    start: dateValueSchema.optional(),
    end: dateOrNoneSchema.optional(),
  })
  .refine(periodInOrder, periodOrderMessage);

export type ResidencePeriod = z.infer<typeof residencePeriodSchema>;

/** A person's fields, before the checks across them; storage derives its schemas from these. */
export const personFieldsSchema = z.strictObject({
  id: opaqueIdSchema,
  birthDate: dateValueSchema.optional(),
  citizenships: z.array(citizenshipSchema).max(10).optional(),
  residenceCountry: countryCodeSchema.optional(),
  /** ISCED 2011 level, 0 to 8: the highest completed, which no qualification exceeds. */
  educationLevel: educationLevelSchema.optional(),
  languages: z.array(languageSchema).max(20).optional(),
  incomes: z.array(incomeSchema).max(20).optional(),
  immigrationHistory: z.array(immigrationEventSchema).max(50).optional(),
  jobOffers: z.array(jobOfferSchema).max(10).optional(),
  /** Work periods, past and current, in any order. */
  workPeriods: z.array(workPeriodSchema).max(maxWorkPeriods).optional(),
  qualifications: z.array(qualificationSchema).max(maxQualifications).optional(),
  registrations: z.array(registrationSchema).max(maxRegistrations).optional(),
  /** Residence periods, past and current, in any order. */
  residencePeriods: z.array(residencePeriodSchema).max(maxResidencePeriods).optional(),
  /** People this person depends on financially. */
  financiallyDependentOn: z.array(opaqueIdSchema).max(20).optional(),
  studying: z.boolean().optional(),
  recordedInFull: z.array(completenessMarkerSchema).max(completenessMarkers.length).optional(),
});

/**
 * A person: structured facts only. An absent field is unknown, never false; a present list is
 * complete, so `[]` means none (spec 0002, R3).
 */
export const personSchema = personFieldsSchema
  .refine((person) => !(person.financiallyDependentOn ?? []).includes(person.id), {
    message: 'A person does not depend on themselves',
  })
  .refine((person) => distinct(person.financiallyDependentOn ?? []), {
    message: 'Dependence is listed once per person',
  })
  .refine((person) => distinct(person.recordedInFull ?? []), {
    message: 'A completeness marker is listed once',
  })
  .refine(qualificationsWithinLevel, qualificationLevelMessage);

export const coupleEdgeSchema = z.strictObject({
  kind: z.enum(['spouse', 'partner']),
  people: z.tuple([opaqueIdSchema, opaqueIdSchema]),
  start: dateValueSchema.optional(),
  end: dateOrNoneSchema.optional(),
});

export const parentEdgeSchema = z.strictObject({
  kind: z.literal('parent'),
  parent: opaqueIdSchema,
  child: opaqueIdSchema,
  parentKind: z.enum(parentKinds).optional(),
  custody: z.enum(custodies).optional(),
  /** When the link began, for an adoption; without one it holds from the child's birth. */
  start: dateValueSchema.optional(),
  /** When this parent's legal custody of the child, living together, began, for an adoption. */
  custodyStart: dateValueSchema.optional(),
});

export const relationshipSchema = z.discriminatedUnion('kind', [
  coupleEdgeSchema,
  parentEdgeSchema,
]);

/** A case's size limits, which the API and its definer functions enforce as well. */
export const maxCaseMembers = 30;
export const maxCasePeople = 60;
export const maxCaseRelationships = 200;

/** At most this many parent edges per child, so lines of ancestors stay small. */
export const maxParentsPerChild = 4;

/** At most this many couple edges between two people, so paths through couples stay small. */
export const maxCoupleEdgesPerPair = 4;

export const assetKinds = [
  'cash',
  'investment',
  'real_estate',
  'business',
  'retirement',
  'vehicle',
  'other',
] as const;

const maxBusinessEmployees = 10_000_000;

/** What only a business records: where it is seated, since when it operates, how many it employs. */
const businessFieldsSchema = z.strictObject({
  country: countryCodeSchema.optional(),
  operatingSince: dateValueSchema.optional(),
  employees: z.number().int().min(0).max(maxBusinessEmployees).optional(),
});

const businessFieldKeys = Object.keys(businessFieldsSchema.shape);

/** Only a business holds the business fields. */
export const businessFieldsOnBusiness = (asset: {
  readonly kind: string;
  readonly [key: string]: unknown;
}): boolean =>
  asset.kind === 'business' || businessFieldKeys.every((key) => asset[key] === undefined);

export const businessFieldsMessage = { message: 'Only a business has business fields' };

/** An asset's fields, before the checks across them and its owners. */
export const assetFieldsSchema = z.strictObject({
  id: opaqueIdSchema,
  kind: z.enum(assetKinds),
  owners: z
    .array(z.strictObject({ person: opaqueIdSchema, share: decimalSchema }))
    .min(1)
    .max(12),
  value: nonNegativeMoneySchema,
  valuedAt: calendarDateSchema,
  liquid: z.boolean().optional(),
  sold: dateOrNoneSchema.optional(),
  ...businessFieldsSchema.shape,
});

const assetSchema = assetFieldsSchema
  .refine((asset) => validShares(asset.owners), {
    message: 'Owners are distinct, each share is positive and the shares add up to at most 1',
  })
  .refine(businessFieldsOnBusiness, businessFieldsMessage);

/**
 * The engine's only view of a case. It holds no free text, names or document numbers, so it
 * cannot carry instructions; objects are strict. People who are not case members, such as
 * grandparents, may appear in `people` and in relationships.
 */
export const caseSnapshotSchema = z
  .strictObject({
    /**
     * The date the snapshot describes. `"none"`, complete lists and completeness markers hold as
     * of then, so facts are read only at dates on or before it.
     */
    recordedOn: calendarDateSchema,
    members: z.array(opaqueIdSchema).min(1).max(maxCaseMembers),
    people: z.array(personSchema).min(1).max(maxCasePeople),
    relationships: z.array(relationshipSchema).max(maxCaseRelationships),
    assets: z.array(assetSchema).max(100),
  })
  .superRefine((snapshot, context) => {
    const issue = (message: string): void => {
      context.addIssue({ code: 'custom', message });
    };
    const ids = snapshot.people.map((person) => person.id);
    const known = new Set(ids);
    if (!distinct(ids)) issue('Person IDs are unique');
    if (!distinct(snapshot.members)) issue('Members are listed once');
    if (!distinct(snapshot.assets.map((asset) => asset.id))) issue('Asset IDs are unique');
    const references = [
      ...snapshot.members,
      ...snapshot.people.flatMap((person) => person.financiallyDependentOn ?? []),
      ...snapshot.relationships.flatMap(endpoints),
      ...snapshot.assets.flatMap((asset) => asset.owners.map((owner) => owner.person)),
    ];
    if (references.some((id) => !known.has(id))) issue('Every referenced person is in `people`');
    const businesses = new Map(
      snapshot.assets.flatMap((asset) =>
        asset.kind === 'business'
          ? [[asset.id, new Set(asset.owners.map((owner) => owner.person))] as const]
          : [],
      ),
    );
    const atBusinessesTheyOwn = snapshot.people.every((person) =>
      (person.workPeriods ?? []).every(
        ({ business }) => business === undefined || businesses.get(business)?.has(person.id),
      ),
    );
    if (!atBusinessesTheyOwn) issue('A work period is at a business its person owns');
    if (snapshot.relationships.map(endpoints).some(([a, b]) => a === b)) {
      issue('A relationship links two different people');
    }
    if (!distinct(snapshot.relationships.map(edgeKey))) issue('A relationship is listed once');
    const parentEdges = snapshot.relationships.filter((edge) => edge.kind === 'parent');
    const parentCounts = new Map<string, number>();
    for (const edge of parentEdges) {
      parentCounts.set(edge.child, (parentCounts.get(edge.child) ?? 0) + 1);
    }
    if ([...parentCounts.values()].some((count) => count > maxParentsPerChild)) {
      issue(`A person has at most ${String(maxParentsPerChild)} parents`);
    }
    const pairCounts = new Map<string, number>();
    for (const edge of snapshot.relationships) {
      if (edge.kind === 'parent') continue;
      const pair = [...edge.people].sort().join(':');
      pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    }
    if ([...pairCounts.values()].some((count) => count > maxCoupleEdgesPerPair)) {
      issue(`Two people share at most ${String(maxCoupleEdgesPerPair)} couple edges`);
    }
    if (hasParentCycle(parentEdges)) issue('Nobody is their own ancestor');
  });

export type CaseSnapshot = z.infer<typeof caseSnapshotSchema>;
export type Person = z.infer<typeof personSchema>;
export type Relationship = z.infer<typeof relationshipSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Citizenship = z.infer<typeof citizenshipSchema>;

export function distinct(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/** The two people an edge joins: a parent and a child, or a couple. */
export function endpoints(edge: Relationship): [string, string] {
  return edge.kind === 'parent' ? [edge.parent, edge.child] : [edge.people[0], edge.people[1]];
}

/** Couples may marry twice, even within a year, so a couple edge is told apart by its dates. */
export function edgeKey(edge: Relationship): string {
  if (edge.kind === 'parent') return `parent:${edge.parent}>${edge.child}`;
  const [a, b] = [...edge.people].sort();
  return `${edge.kind}:${a ?? ''}:${b ?? ''}:${edge.start ?? ''}:${edge.end ?? ''}`;
}

function hasParentCycle(edges: readonly { parent: string; child: string }[]): boolean {
  const parentsOf = new Map<string, string[]>();
  for (const { parent, child } of edges) {
    parentsOf.set(child, [...(parentsOf.get(child) ?? []), parent]);
  }
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (done.has(id)) return false;
    visiting.add(id);
    const cyclic = (parentsOf.get(id) ?? []).some(visit);
    visiting.delete(id);
    done.add(id);
    return cyclic;
  };
  return [...parentsOf.keys()].some(visit);
}

function validShares(owners: readonly { person: string; share: string }[]): boolean {
  if (!distinct(owners.map((owner) => owner.person))) return false;
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
