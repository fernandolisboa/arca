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

/** Whether a draft reference names a person new to the case (`n1`), not a known one. */
export const isNewReference = (ref: string): boolean => /^n[0-9]{1,2}$/.test(ref);

/** The roles whose new person usually belongs to the plan, so the screen starts them as members. */
const planRoles: ReadonlySet<IntakeRole> = new Set(['self', 'spouse', 'partner', 'child']);
export const startsInPlan = (role: IntakeRole | undefined): boolean =>
  role !== undefined && planRoles.has(role);

export const maxDraftPeople = 20;
export const maxDraftRelationships = 40;

/** A draft whose people are referred to by `reference`: placeholders for the model, IDs for the API. */
const draftSchemaFor = (reference: z.ZodString) => {
  const person = z.strictObject({
    ref: reference,
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
  const parent = z.strictObject({
    kind: z.literal('parent'),
    parent: reference,
    child: reference,
    parentKind: z.enum(parentKinds).optional(),
    start: dateValueSchema.optional(),
  });
  const couple = z.strictObject({
    kind: z.enum(['spouse', 'partner']),
    /** An array, not a tuple: Anthropic's structured outputs drop tuple schemas (`prefixItems`). */
    people: z.array(reference).length(2),
    start: dateValueSchema.optional(),
  });
  return z.strictObject({
    people: z.array(person).max(maxDraftPeople),
    relationships: z.array(z.union([parent, couple])).max(maxDraftRelationships),
  });
};

/** The shape the model answers in; `parseIntakeDraft` adds the checks across fields. */
export const intakeDraftSchema = draftSchemaFor(intakeReferenceSchema);

/** The draft as the API answers it: a known person by their case ID, a new one as `n1`, `n2` … */
export const caseIntakeDraftSchema = draftSchemaFor(
  z
    .string()
    .regex(/^(?:n[0-9]{1,2}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/),
);
export type CaseIntakeDraft = z.infer<typeof caseIntakeDraftSchema>;

export type IntakeDraft = z.infer<typeof intakeDraftSchema>;
export type DraftPerson = IntakeDraft['people'][number];
export type DraftRelationship = IntakeDraft['relationships'][number];

const draftEndpoints = (edge: DraftRelationship): readonly string[] =>
  edge.kind === 'parent' ? [edge.parent, edge.child] : edge.people;

/**
 * The model's reply as a draft, or `undefined` when it does not parse: people are listed once and
 * a placeholder is one of those sent. A relationship that does not join two different people of
 * the draft, such as one to a former partner the text only implies, is dropped: it carries no fact
 * the draft could keep, and the rest of the reply still holds.
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
  const joinsTwoListed = (edge: DraftRelationship) => {
    const [a, b] = draftEndpoints(edge);
    return a !== undefined && b !== undefined && a !== b && listed.has(a) && listed.has(b);
  };
  return {
    people: draft.people.map(distinctLists),
    relationships: draft.relationships.filter(joinsTwoListed),
  };
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

/**
 * The draft with a new person of the role `self` as the writer's own person in the case. When the
 * draft lists the writer already, the new one is merged into them, the listed writer's facts
 * winning, and an edge between the two is dropped. Left as it is when it proposes more than one
 * new writer.
 */
export function withWriter<Draft extends IntakeDraft>(draft: Draft, writerId: string): Draft {
  const writers = draft.people.filter(({ ref, role }) => isNewReference(ref) && role === 'self');
  const [writer] = writers;
  if (writer === undefined || writers.length > 1) return draft;
  const listed = draft.people.find(({ ref }) => ref === writerId);
  const merged =
    listed === undefined
      ? draft
      : {
          ...draft,
          people: draft.people.flatMap((person) => {
            if (person === writer) return [];
            return person === listed ? [{ ...writer, ...listed }] : [person];
          }),
        };
  const renamed = renameDraft(merged, (ref) => (ref === writer.ref ? writerId : ref));
  return {
    ...renamed,
    relationships: renamed.relationships.filter((edge) => {
      const [a, b] = draftEndpoints(edge);
      return a !== b;
    }),
  };
}

/** The draft with every reference renamed, such as placeholders to case IDs. */
export function renameDraft<Draft extends IntakeDraft>(
  draft: Draft,
  rename: (ref: string) => string,
): Draft {
  return {
    ...draft,
    people: draft.people.map((person) => ({ ...person, ref: rename(person.ref) })),
    relationships: draft.relationships.map((edge) =>
      edge.kind === 'parent'
        ? { ...edge, parent: rename(edge.parent), child: rename(edge.child) }
        : { ...edge, people: edge.people.map(rename) },
    ),
  };
}
