import { z } from 'zod';
import { ageYears } from '../calendar/age.js';
import { type CalendarDate, calendarDateSchema, compareDates } from '../calendar/calendar-date.js';
import { type DateValue, dateRange, dateValueSchema } from '../calendar/partial-date.js';
import { type CurrencyCode, currencyCodeSchema, unitsAmount } from '../money/currency.js';
import { type QuestionId, questionFlow } from './questions.js';
import {
  type CaseSnapshot,
  type CompletenessMarker,
  type Person,
  assetKinds,
  citizenshipBases,
  completenessMarkers,
  countryCodeSchema,
  custodies,
  immigrationEventKinds,
  incomeKinds,
  isicSections,
  languageLevels,
  parentKinds,
} from './snapshot.js';

/**
 * The case read back as sentences (spec 0007, R5): each a kind and typed values, never text, so
 * the client words it through i18n with the viewer's names. People are IDs: the snapshot's opaque
 * ones from `describeCase`, the case's own once the API relabels them. `about` names the people
 * whose question the sentence links to.
 */
const person = z.string();
const dateOrNone = z.union([dateValueSchema, z.literal('none')]);
const amount = z.strictObject({
  amount: z.string().regex(/^\d+(?:\.\d+)?$/),
  currency: currencyCodeSchema,
});
const ageRange = z.strictObject({ min: z.number().int().min(0), max: z.number().int().min(0) });
const sentence = <Kind extends string, Shape extends z.ZodRawShape>(kind: Kind, shape: Shape) =>
  z.strictObject({
    kind: z.literal(kind),
    question: z.enum(questionFlow.map(({ id }) => id) as [QuestionId, ...QuestionId[]]).optional(),
    about: z.array(person).min(1).max(12),
    ...shape,
  });

export const sentenceSchema = z.discriminatedUnion('kind', [
  sentence('profileHidden', { person }),
  sentence('financesHidden', { person }),
  sentence('unanswered', { person }),
  sentence('born', { person, date: dateValueSchema, age: ageRange.optional() }),
  sentence('citizenship', {
    person,
    country: countryCodeSchema,
    basis: z.enum(citizenshipBases).optional(),
    acquired: dateValueSchema.optional(),
    lost: dateOrNone.optional(),
  }),
  sentence('noCitizenship', { person }),
  sentence('residence', { person, country: countryCodeSchema }),
  sentence('education', { person, level: z.number().int().min(0).max(8) }),
  sentence('studying', { person, studying: z.boolean() }),
  sentence('language', { person, language: z.string(), level: z.enum(languageLevels) }),
  sentence('noLanguage', { person }),
  sentence('jobOffer', {
    person,
    country: countryCodeSchema,
    sector: z.enum(isicSections as [string, ...string[]]),
    temporary: z.boolean(),
  }),
  sentence('noJobOffer', { person }),
  sentence('immigrationEvent', {
    person,
    country: countryCodeSchema,
    event: z.enum(immigrationEventKinds),
    date: dateValueSchema.optional(),
  }),
  sentence('noImmigrationEvent', { person }),
  sentence('dependsOn', { person, on: z.array(person).min(1) }),
  sentence('independent', { person }),
  sentence('recordedInFull', { person, marker: z.enum(completenessMarkers) }),
  sentence('income', {
    person,
    income: z.enum(incomeKinds),
    monthly: amount,
    sourceCountry: countryCodeSchema,
  }),
  sentence('noIncome', { person }),
  sentence('couple', {
    couple: z.enum(['spouse', 'partner']),
    people: z.tuple([person, person]),
    start: dateValueSchema.optional(),
    end: dateOrNone.optional(),
  }),
  sentence('parent', {
    parent: person,
    child: person,
    parentKind: z.enum(parentKinds).optional(),
    custody: z.enum(custodies).optional(),
    start: dateValueSchema.optional(),
  }),
  sentence('asset', {
    asset: z.enum(assetKinds),
    value: amount,
    valuedAt: calendarDateSchema,
    owners: z.array(z.strictObject({ person, share: z.string() })).min(1),
    liquid: z.boolean().optional(),
    sold: dateOrNone.optional(),
  }),
]);

export type Sentence = z.infer<typeof sentenceSchema>;
export type SentenceKind = Sentence['kind'];

/** What the viewer sees of each person, by the snapshot's person ID. */
export type PlaybackVisibility = ReadonlyMap<
  string,
  { readonly profile: boolean; readonly finances: boolean }
>;

const markerQuestions: Record<CompletenessMarker, QuestionId> = {
  spouses: 'allSpouses',
  partners: 'allPartners',
  children: 'allChildren',
  parents: 'allParents',
  assets: 'allAssets',
};

/** Profile and finance questions a person may leave unanswered, in flow order. */
interface FactQuestion {
  readonly id: QuestionId;
  readonly scope: 'profile' | 'finances';
  readonly key: string;
}

const factQuestions: readonly FactQuestion[] = questionFlow.flatMap((question): FactQuestion[] => {
  const { target } = question;
  if (target.kind === 'fact') return [{ id: question.id, scope: 'profile', key: target.key }];
  if (target.kind === 'dependence')
    return [{ id: question.id, scope: 'profile', key: 'dependence' }];
  if (target.kind === 'incomes') return [{ id: question.id, scope: 'finances', key: 'incomes' }];
  return [];
});

const decimalAmount = ({ amount, currency }: { amount: number; currency: CurrencyCode }) => ({
  amount: unitsAmount(amount, currency),
  currency,
});

/** Whole years of age at `at`, as a range when the birth date is partial; none before birth. */
function ageAt(birthDate: DateValue, at: CalendarDate) {
  const { min, max } = dateRange(birthDate);
  if (compareDates(max, at) > 0) return undefined;
  return { min: ageYears(max, at, 'march-1'), max: ageYears(min, at, 'feb-28') };
}

const optional = <Key extends string, Value>(key: Key, value: Value | undefined) =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<Key, Value>>;

function describePerson(
  subject: Person,
  visible: { readonly profile: boolean; readonly finances: boolean },
  at: CalendarDate,
): Sentence[] {
  const id = subject.id;
  const about = [id];
  const said: Sentence[] = [];
  const unanswered = (question: QuestionId) => {
    said.push({ kind: 'unanswered', question, about, person: id });
  };
  if (!visible.profile) said.push({ kind: 'profileHidden', about, person: id });
  if (!visible.finances) said.push({ kind: 'financesHidden', about, person: id });
  for (const { id: question, scope, key } of factQuestions) {
    if (!visible[scope]) continue;
    const ask = { question, about, person: id };
    switch (key) {
      case 'birthDate':
        if (subject.birthDate === undefined) unanswered(question);
        else {
          said.push({
            kind: 'born',
            ...ask,
            date: subject.birthDate,
            ...optional('age', ageAt(subject.birthDate, at)),
          });
        }
        break;
      case 'citizenships':
        if (subject.citizenships === undefined) unanswered(question);
        else if (subject.citizenships.length === 0) said.push({ kind: 'noCitizenship', ...ask });
        else {
          for (const held of subject.citizenships)
            said.push({ kind: 'citizenship', ...ask, ...held });
        }
        break;
      case 'residenceCountry':
        if (subject.residenceCountry === undefined) unanswered(question);
        else said.push({ kind: 'residence', ...ask, country: subject.residenceCountry });
        break;
      case 'educationLevel':
        if (subject.educationLevel === undefined) unanswered(question);
        else said.push({ kind: 'education', ...ask, level: subject.educationLevel });
        break;
      case 'studying':
        if (subject.studying === undefined) unanswered(question);
        else said.push({ kind: 'studying', ...ask, studying: subject.studying });
        break;
      case 'languages':
        if (subject.languages === undefined) unanswered(question);
        else if (subject.languages.length === 0) said.push({ kind: 'noLanguage', ...ask });
        else
          for (const spoken of subject.languages)
            said.push({ kind: 'language', ...ask, ...spoken });
        break;
      case 'jobOffers':
        if (subject.jobOffers === undefined) unanswered(question);
        else if (subject.jobOffers.length === 0) said.push({ kind: 'noJobOffer', ...ask });
        else
          for (const offer of subject.jobOffers) said.push({ kind: 'jobOffer', ...ask, ...offer });
        break;
      case 'immigrationHistory':
        if (subject.immigrationHistory === undefined) unanswered(question);
        else if (subject.immigrationHistory.length === 0) {
          said.push({ kind: 'noImmigrationEvent', ...ask });
        } else {
          for (const { kind, ...event } of subject.immigrationHistory) {
            said.push({ kind: 'immigrationEvent', ...ask, ...event, event: kind });
          }
        }
        break;
      case 'dependence': {
        const on = subject.financiallyDependentOn;
        if (on === undefined) unanswered(question);
        else if (on.length === 0) said.push({ kind: 'independent', ...ask });
        else said.push({ kind: 'dependsOn', ...ask, on: [...on] });
        break;
      }
      case 'incomes':
        if (subject.incomes === undefined) unanswered(question);
        else if (subject.incomes.length === 0) said.push({ kind: 'noIncome', ...ask });
        else {
          for (const { kind, monthly, sourceCountry } of subject.incomes) {
            said.push({
              kind: 'income',
              ...ask,
              income: kind,
              monthly: decimalAmount(monthly),
              sourceCountry,
            });
          }
        }
        break;
    }
  }
  for (const marker of subject.recordedInFull ?? []) {
    said.push({
      kind: 'recordedInFull',
      question: markerQuestions[marker],
      about,
      person: id,
      marker,
    });
  }
  return said;
}

/**
 * The case as sentences, person by person in the snapshot's order, then relationships, then
 * assets (spec 0007, R5). A person whose profile or finances the viewer does not see reads as not
 * shared, never as unanswered; ages are whole years at `at`.
 */
export function describeCase(
  snapshot: CaseSnapshot,
  visibility: PlaybackVisibility,
  at: CalendarDate,
): Sentence[] {
  const people = snapshot.people.flatMap((subject) =>
    describePerson(subject, visibility.get(subject.id) ?? { profile: false, finances: false }, at),
  );
  const relationships = snapshot.relationships.map((edge): Sentence => {
    if (edge.kind === 'parent') {
      const { parent, child, parentKind, custody, start } = edge;
      return {
        kind: 'parent',
        question: 'relationships',
        about: [parent, child],
        parent,
        child,
        ...optional('parentKind', parentKind),
        ...optional('custody', custody),
        ...optional('start', start),
      };
    }
    return {
      kind: 'couple',
      question: 'relationships',
      about: [...edge.people],
      couple: edge.kind,
      people: edge.people,
      ...optional('start', edge.start),
      ...optional('end', edge.end),
    };
  });
  const assets = snapshot.assets.map(
    ({ kind, value, valuedAt, owners, liquid, sold }): Sentence => ({
      kind: 'asset',
      question: 'assets',
      about: owners.map((owner) => owner.person),
      asset: kind,
      value: decimalAmount(value),
      valuedAt,
      owners: owners.map((owner) => ({ person: owner.person, share: owner.share })),
      ...optional('liquid', liquid),
      ...optional('sold', sold),
    }),
  );
  return [...people, ...relationships, ...assets];
}

/** The sentences with every person ID renamed, such as the snapshot's opaque IDs to the case's. */
export function renamePeople(
  sentences: readonly Sentence[],
  rename: (id: string) => string,
): Sentence[] {
  return sentences.map((said) => {
    const renamed: Record<string, unknown> = { ...said, about: said.about.map(rename) };
    for (const key of ['person', 'parent', 'child'] as const) {
      const value = renamed[key];
      if (typeof value === 'string') renamed[key] = rename(value);
    }
    if (said.kind === 'dependsOn') renamed['on'] = said.on.map(rename);
    if (said.kind === 'couple')
      renamed['people'] = [rename(said.people[0]), rename(said.people[1])];
    if (said.kind === 'asset') {
      renamed['owners'] = said.owners.map((owner) => ({ ...owner, person: rename(owner.person) }));
    }
    return sentenceSchema.parse(renamed);
  });
}
