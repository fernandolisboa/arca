import { z } from 'zod';
import { dateValueSchema } from '../calendar/partial-date.js';
import { languageCodes } from '../case/languages.js';
import { countryCodeSchema, languageLevels, parentKinds } from '../case/snapshot.js';
import { statedDates } from './dates.js';

/**
 * A draft of guided-question answers proposed from a member's own words (spec 0008, R1). It holds
 * no free text: references, codes, enums and dates only, so a reply that parses cannot carry an
 * instruction or a name. Every field is optional, and a list is never empty, so a draft cannot
 * claim that someone has no citizenship.
 */

export const intakeRoles = [
  'self',
  'spouse',
  'partner',
  'child',
  'parent',
  'grandparent',
  'sibling',
  'other',
] as const;
export type IntakeRole = (typeof intakeRoles)[number];

/** A person new to the case (`n1`), or the placeholder of a known one (`[P1]`). */
export const intakeReferenceSchema = z.string().regex(/^(?:n[0-9]{1,2}|\[P[0-9]{1,3}\])$/);

export const maxDraftPeople = 20;
export const maxDraftRelationships = 40;

const draftPersonSchema = z.strictObject({
  ref: intakeReferenceSchema,
  /** A label hint for the screen; never a relationship. */
  role: z.enum(intakeRoles).optional(),
  birthDate: dateValueSchema.optional(),
  citizenships: z.array(countryCodeSchema).min(1).max(10).optional(),
  residenceCountry: countryCodeSchema.optional(),
  /** ISCED 2011 level, 0 to 8. */
  educationLevel: z.number().int().min(0).max(8).optional(),
  languages: z
    .array(
      z.strictObject({
        language: z.enum(languageCodes),
        level: z.enum(languageLevels),
      }),
    )
    .min(1)
    .max(20)
    .optional(),
});

const draftParentSchema = z.strictObject({
  kind: z.literal('parent'),
  parent: intakeReferenceSchema,
  child: intakeReferenceSchema,
  parentKind: z.enum(parentKinds).optional(),
  start: dateValueSchema.optional(),
});

const draftCoupleSchema = z.strictObject({
  kind: z.enum(['spouse', 'partner']),
  people: z.tuple([intakeReferenceSchema, intakeReferenceSchema]),
  start: dateValueSchema.optional(),
});

/** The shape the model answers in; `parseIntakeDraft` adds the checks across fields. */
export const intakeDraftSchema = z.strictObject({
  people: z.array(draftPersonSchema).max(maxDraftPeople),
  relationships: z
    .array(z.union([draftParentSchema, draftCoupleSchema]))
    .max(maxDraftRelationships),
});

export type IntakeDraft = z.infer<typeof intakeDraftSchema>;
export type DraftPerson = IntakeDraft['people'][number];
export type DraftRelationship = IntakeDraft['relationships'][number];

const draftEndpoints = (edge: DraftRelationship): readonly string[] =>
  edge.kind === 'parent' ? [edge.parent, edge.child] : edge.people;

/**
 * The model's reply as a draft, or `undefined` when it does not parse: people are listed once,
 * a placeholder is one of those sent, and every relationship joins two different people of the
 * draft.
 */
export function parseIntakeDraft(
  reply: unknown,
  knownPlaceholders: ReadonlySet<string>,
): IntakeDraft | undefined {
  const parsed = intakeDraftSchema.safeParse(reply);
  if (!parsed.success) return undefined;
  const draft = parsed.data;
  const refs = draft.people.map(({ ref }) => ref);
  const listed = new Set(refs);
  if (listed.size !== refs.length) return undefined;
  if (refs.some((ref) => ref.startsWith('[') && !knownPlaceholders.has(ref))) return undefined;
  for (const edge of draft.relationships) {
    const [a, b] = draftEndpoints(edge);
    if (a === undefined || b === undefined || a === b || !listed.has(a) || !listed.has(b)) {
      return undefined;
    }
  }
  return { ...draft, people: draft.people.map(distinctLists) };
}

/**
 * A person's lists with repeats removed; a language proposed at two levels is left out, since
 * the reply does not say which one holds.
 */
function distinctLists(person: DraftPerson): DraftPerson {
  const { citizenships, languages, ...rest } = person;
  const countries = citizenships === undefined ? [] : [...new Set(citizenships)];
  const levels = new Map<string, Set<string>>();
  for (const { language, level } of languages ?? []) {
    levels.set(language, (levels.get(language) ?? new Set()).add(level));
  }
  const spoken = (languages ?? []).filter(
    (entry, index, all) =>
      levels.get(entry.language)?.size === 1 &&
      all.findIndex(({ language }) => language === entry.language) === index,
  );
  return {
    ...rest,
    ...(countries.length === 0 ? {} : { citizenships: countries }),
    ...(spoken.length === 0 ? {} : { languages: spoken }),
  };
}

const datePattern = /^([0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2}))?)?$/;

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * The draft with every date cut to the precision the text states it at, or dropped when the text
 * does not state its year, so an age, "há 15 anos" or an invented day never becomes a date
 * (spec 0008, R1; CLAUDE.md rule 3). It walks every field, so a date field added later is covered.
 */
export function keepStatedDates(draft: IntakeDraft, maskedText: string): IntakeDraft {
  const stated = statedDates(maskedText);
  const days = new Set(
    stated.flatMap(({ year, month, day }) =>
      month === undefined || day === undefined ? [] : [`${String(year)}-${pad(month)}-${pad(day)}`],
    ),
  );
  const months = new Set(
    stated.flatMap(({ year, month }) =>
      month === undefined ? [] : [`${String(year)}-${pad(month)}`],
    ),
  );
  const years = new Set(stated.map(({ year }) => String(year)));
  const cut = (date: string): string | undefined => {
    const match = datePattern.exec(date);
    if (match === null) return date;
    const [, year = '', month, day] = match;
    if (day !== undefined && days.has(date)) return date;
    if (month !== undefined && months.has(`${year}-${month}`)) return `${year}-${month}`;
    return years.has(year) ? year : undefined;
  };
  const walk = (value: unknown, keep: typeof cut): unknown => {
    if (Array.isArray(value)) return value.map((item) => walk(item, keep));
    if (typeof value !== 'object' || value === null) return value;
    const entries = Object.entries(value).flatMap(([key, field]): [string, unknown][] => {
      if (typeof field !== 'string' || !datePattern.test(field)) return [[key, walk(field, keep)]];
      const kept = keep(field);
      return kept === undefined ? [] : [[key, kept]];
    });
    return Object.fromEntries(entries);
  };
  const cutDraft = intakeDraftSchema.safeParse(walk(draft, cut));
  return cutDraft.success ? cutDraft.data : intakeDraftSchema.parse(walk(draft, () => undefined));
}
