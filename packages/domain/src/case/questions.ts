import { currencyCodeSchema, minorUnitExponent, unitsAmount } from '../money/currency.js';
import {
  compareScaled,
  decimalSchema,
  normalizeScaled,
  powerOfTen,
  scaledDecimal,
} from '../money/decimal.js';
import { languageCodes } from './languages.js';
import {
  assetKinds,
  citizenshipBases,
  custodies,
  immigrationEventKinds,
  incomeKinds,
  isicSections,
  languageLevels,
  parentKinds,
  qualificationStatuses,
  residenceBases,
  workCapacities,
  workRelations,
} from './snapshot.js';
import {
  type StoredAsset,
  type StoredFinances,
  type StoredProfile,
  type StoredRelationship,
  profileMarkers,
  storedAssetSchema,
  storedFinancesSchema,
  storedOwnerShareSchema,
  storedProfileFactsSchema,
  storedRelationshipSchema,
} from './storage.js';

/**
 * The guided questions (spec 0007, R4): an ordered list of steps, each with questions that set
 * one part of a person's stored case and say how it is answered. Screens render a question by its
 * step and ID, so a new fact adds a question here without touching them. An answer has the stored
 * shape, but for amounts, which are decimal strings in the currency's units, and for assets and
 * relationships, which carry their IDs.
 */

export const questionSteps = [
  'basics',
  'studies',
  'work',
  'finances',
  'history',
  'family',
] as const;
export type QuestionStep = (typeof questionSteps)[number];

export const choiceSets = {
  citizenshipBasis: citizenshipBases,
  /** ISCED 2011 levels. */
  educationLevel: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  /** The ISCED 2011 levels a course can lead to: technical secondary and above. */
  qualificationLevel: [3, 4, 5, 6, 7, 8],
  qualificationStatus: qualificationStatuses,
  languageLevel: languageLevels,
  isicSection: isicSections as readonly string[],
  incomeKind: incomeKinds,
  assetKind: assetKinds,
  immigrationEvent: immigrationEventKinds,
  parentKind: parentKinds,
  custody: custodies,
  workRelation: workRelations,
  workCapacity: workCapacities,
  residenceBasis: residenceBases,
} as const;
export type ChoiceSet = keyof typeof choiceSets;

export type FieldInput =
  /** `partial` takes a year, or a year and month; `none` adds "never" or "not yet". */
  | { readonly kind: 'date'; readonly precision: 'partial' | 'day'; readonly none?: true }
  | { readonly kind: 'country'; readonly formerStates?: true }
  | { readonly kind: 'language' }
  | { readonly kind: 'choice'; readonly set: ChoiceSet }
  | { readonly kind: 'yesNo' }
  | { readonly kind: 'money' }
  /** A share of an asset, more than 0 and at most 1, as a decimal string. */
  | { readonly kind: 'share' }
  /** An ISCO-08 occupation code, picked by its name. */
  | { readonly kind: 'occupation' }
  /** A whole number from zero, such as a head count. */
  | { readonly kind: 'count' }
  /** One of the businesses the person owns a confirmed share of, by its asset ID. */
  | { readonly kind: 'business' }
  /** An ISCED-F 2013 field-of-study code, picked by its name. */
  | { readonly kind: 'studyField' }
  /** A short name that tells items apart on screen; kept with the profile, never in the snapshot. */
  | { readonly kind: 'label' };

export interface QuestionField<Key extends string = string> {
  readonly key: Key;
  readonly input: FieldInput;
  /** Whether "Não sei" may leave it out. */
  readonly optional: boolean;
  /** Asked only while another field of the item holds this value; otherwise left out. */
  readonly onlyWhen?: { readonly key: string; readonly value: string };
}

export type QuestionInput =
  | FieldInput
  | { readonly kind: 'list'; readonly fields: readonly QuestionField[] }
  /** Other people of the case, or nobody. */
  | { readonly kind: 'people' }
  /** "Are these all of them?": yes sets a completeness marker. */
  | { readonly kind: 'complete' }
  /** The details of the person's relationships, by kind. */
  | {
      readonly kind: 'relationships';
      readonly couple: readonly QuestionField[];
      readonly parent: readonly QuestionField[];
    };

type ProfileMarker = (typeof profileMarkers)[number];
type FactKey = Exclude<keyof StoredProfile['facts'], 'recordedInFull'>;

export type QuestionTarget =
  | { readonly kind: 'fact'; readonly key: FactKey }
  | { readonly kind: 'marker'; readonly marker: ProfileMarker }
  | { readonly kind: 'dependence' }
  | { readonly kind: 'incomes' }
  | { readonly kind: 'assetsMarker' }
  | { readonly kind: 'assets' }
  | { readonly kind: 'relationships' };

export interface Question {
  readonly id: string;
  readonly step: QuestionStep;
  readonly target: QuestionTarget;
  readonly input: QuestionInput;
}

const partialDate = { kind: 'date', precision: 'partial' } as const;
const needed = <Key extends string>(key: Key, input: FieldInput) =>
  ({ key, input, optional: false }) as const;
const maybe = <Key extends string>(key: Key, input: FieldInput) =>
  ({ key, input, optional: true }) as const;
const onlyWhen =
  (key: string, value: string) =>
  <Field extends QuestionField>(field: Field) =>
    ({ ...field, onlyWhen: { key, value } }) as const;
const businessOnly = onlyWhen('kind', 'business');
const fact = (key: FactKey) => ({ kind: 'fact', key }) as const;
const marker = <Id extends string>(id: Id, value: ProfileMarker) =>
  ({
    id,
    step: 'family',
    target: { kind: 'marker', marker: value },
    input: { kind: 'complete' },
  }) as const;

export const questionFlow = [
  { id: 'birthDate', step: 'basics', target: fact('birthDate'), input: partialDate },
  {
    id: 'citizenships',
    step: 'basics',
    target: fact('citizenships'),
    input: {
      kind: 'list',
      fields: [
        needed('country', { kind: 'country', formerStates: true }),
        maybe('acquired', partialDate),
        maybe('lost', { ...partialDate, none: true }),
        maybe('basis', { kind: 'choice', set: 'citizenshipBasis' }),
      ],
    },
  },
  {
    id: 'residenceCountry',
    step: 'basics',
    target: fact('residenceCountry'),
    input: { kind: 'country' },
  },
  {
    id: 'educationLevel',
    step: 'studies',
    target: fact('educationLevel'),
    input: { kind: 'choice', set: 'educationLevel' },
  },
  {
    id: 'qualifications',
    step: 'studies',
    target: fact('qualifications'),
    input: {
      kind: 'list',
      fields: [
        maybe('level', { kind: 'choice', set: 'qualificationLevel' }),
        maybe('field', { kind: 'studyField' }),
        needed('status', { kind: 'choice', set: 'qualificationStatus' }),
        maybe('country', { kind: 'country', formerStates: true }),
        onlyWhen('status', 'completed')(maybe('completed', partialDate)),
      ],
    },
  },
  { id: 'studying', step: 'studies', target: fact('studying'), input: { kind: 'yesNo' } },
  {
    id: 'languages',
    step: 'studies',
    target: fact('languages'),
    input: {
      kind: 'list',
      fields: [
        needed('language', { kind: 'language' }),
        needed('level', { kind: 'choice', set: 'languageLevel' }),
      ],
    },
  },
  {
    id: 'workPeriods',
    step: 'work',
    target: fact('workPeriods'),
    input: {
      kind: 'list',
      fields: [
        maybe('label', { kind: 'label' }),
        maybe('occupation', { kind: 'occupation' }),
        maybe('relation', { kind: 'choice', set: 'workRelation' }),
        maybe('capacity', { kind: 'choice', set: 'workCapacity' }),
        maybe('fullTime', { kind: 'yesNo' }),
        maybe('employerCountry', { kind: 'country' }),
        maybe('workplaceCountry', { kind: 'country' }),
        maybe('start', partialDate),
        maybe('end', { ...partialDate, none: true }),
        onlyWhen('relation', 'owner')(maybe('business', { kind: 'business' })),
      ],
    },
  },
  {
    id: 'registrations',
    step: 'work',
    target: fact('registrations'),
    input: {
      kind: 'list',
      fields: [
        maybe('country', { kind: 'country' }),
        maybe('occupation', { kind: 'occupation' }),
        maybe('since', partialDate),
      ],
    },
  },
  {
    id: 'jobOffers',
    step: 'work',
    target: fact('jobOffers'),
    input: {
      kind: 'list',
      fields: [
        needed('country', { kind: 'country' }),
        needed('sector', { kind: 'choice', set: 'isicSection' }),
        needed('temporary', { kind: 'yesNo' }),
        maybe('occupation', { kind: 'occupation' }),
        maybe('annualSalary', { kind: 'money' }),
        maybe('sponsored', { kind: 'yesNo' }),
      ],
    },
  },
  {
    id: 'incomes',
    step: 'finances',
    target: { kind: 'incomes' },
    input: {
      kind: 'list',
      fields: [
        needed('kind', { kind: 'choice', set: 'incomeKind' }),
        needed('monthly', { kind: 'money' }),
        needed('sourceCountry', { kind: 'country' }),
      ],
    },
  },
  { id: 'dependsOn', step: 'finances', target: { kind: 'dependence' }, input: { kind: 'people' } },
  {
    id: 'assets',
    step: 'finances',
    target: { kind: 'assets' },
    input: {
      kind: 'list',
      fields: [
        needed('kind', { kind: 'choice', set: 'assetKind' }),
        needed('value', { kind: 'money' }),
        needed('valuedAt', { kind: 'date', precision: 'day' }),
        maybe('liquid', { kind: 'yesNo' }),
        maybe('sold', { ...partialDate, none: true }),
        businessOnly(maybe('country', { kind: 'country' })),
        businessOnly(maybe('operatingSince', partialDate)),
        businessOnly(maybe('employees', { kind: 'count' })),
        needed('share', { kind: 'share' }),
      ],
    },
  },
  {
    id: 'allAssets',
    step: 'finances',
    target: { kind: 'assetsMarker' },
    input: { kind: 'complete' },
  },
  {
    id: 'residencePeriods',
    step: 'history',
    target: fact('residencePeriods'),
    input: {
      kind: 'list',
      fields: [
        needed('country', { kind: 'country' }),
        maybe('basis', { kind: 'choice', set: 'residenceBasis' }),
        maybe('start', partialDate),
        maybe('end', { ...partialDate, none: true }),
      ],
    },
  },
  {
    id: 'immigrationHistory',
    step: 'history',
    target: fact('immigrationHistory'),
    input: {
      kind: 'list',
      fields: [
        needed('country', { kind: 'country' }),
        needed('kind', { kind: 'choice', set: 'immigrationEvent' }),
        maybe('date', partialDate),
      ],
    },
  },
  marker('allSpouses', 'spouses'),
  marker('allPartners', 'partners'),
  marker('allChildren', 'children'),
  marker('allParents', 'parents'),
  {
    id: 'relationships',
    step: 'family',
    target: { kind: 'relationships' },
    input: {
      kind: 'relationships',
      couple: [maybe('start', partialDate), maybe('end', { ...partialDate, none: true })],
      parent: [
        maybe('parentKind', { kind: 'choice', set: 'parentKind' }),
        maybe('custody', { kind: 'choice', set: 'custody' }),
        maybe('start', partialDate),
        maybe('custodyStart', partialDate),
      ],
    },
  },
] as const satisfies readonly Question[];

export type QuestionId = (typeof questionFlow)[number]['id'];
export const questionIds = questionFlow.map(({ id }) => id) as [QuestionId, ...QuestionId[]];

export type Answer =
  string | number | boolean | null | readonly Answer[] | { [key: string]: Answer };

/** An asset a person holds a confirmed share of; a new one has no ID yet. */
export interface HeldAsset {
  readonly id?: string;
  readonly asset: StoredAsset;
  readonly share: string;
}

export interface RelationshipRow {
  readonly id: string;
  readonly relationship: StoredRelationship;
}

export interface QuestionState {
  readonly facts: StoredProfile['facts'];
  /** Null while dependence is unanswered. */
  readonly dependsOn: readonly string[] | null;
  /** Undefined until the finances are first saved. */
  readonly finances: StoredFinances | undefined;
  readonly assets: readonly HeldAsset[];
  readonly relationships: readonly RelationshipRow[];
}

export interface KnownCodes {
  readonly countries: ReadonlySet<string>;
  readonly formerCountries: ReadonlySet<string>;
  /** The occupation codes of the current occupations classification. */
  readonly occupations: ReadonlySet<string>;
  /** The field-of-study codes of the current study-fields classification. */
  readonly studyFields: ReadonlySet<string>;
}

const languages: ReadonlySet<string> = new Set(languageCodes);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An amount in minor units as a decimal string in the currency's units, such as `1234.5`. */
function moneyAnswer(value: unknown): unknown {
  if (!isRecord(value) || typeof value['amount'] !== 'number') return value;
  const parsed = currencyCodeSchema.safeParse(value['currency']);
  if (!parsed.success) return value;
  return { amount: unitsAmount(value['amount'], parsed.data), currency: parsed.data };
}

/** The decimal amount back in minor units; null, which the schemas refuse, when it is not one. */
function storedMoney(value: unknown): unknown {
  if (!isRecord(value)) return null;
  const amount = decimalSchema.safeParse(value['amount']);
  const currency = currencyCodeSchema.safeParse(value['currency']);
  if (!amount.success || !currency.success) return null;
  const { units, scale } = normalizeScaled(scaledDecimal(amount.data));
  const exponent = minorUnitExponent(currency.data);
  if (scale > exponent || units < 0n) return null;
  const minor = units * powerOfTen(exponent - scale);
  return minor > BigInt(Number.MAX_SAFE_INTEGER)
    ? null
    : { amount: Number(minor), currency: currency.data };
}

const mapFields = (
  fields: readonly QuestionField[],
  item: unknown,
  money: (value: unknown) => unknown,
): unknown => {
  if (!isRecord(item)) return item;
  const mapped: Record<string, unknown> = { ...item };
  for (const { key, input } of fields) {
    if (input.kind === 'money' && key in mapped) mapped[key] = money(mapped[key]);
  }
  return mapped;
};

const mapList = (input: QuestionInput, value: unknown, money: (value: unknown) => unknown) =>
  input.kind === 'list' && Array.isArray(value)
    ? value.map((item) => mapFields(input.fields, item, money))
    : value;

/**
 * Whether every occupation and field-of-study code in stored facts is one of the classifications',
 * for writes that bypass the guided questions.
 */
export function classifiedCodesKnown(
  facts: StoredProfile['facts'],
  { occupations, studyFields }: Pick<KnownCodes, 'occupations' | 'studyFields'>,
): boolean {
  const named = (code: string | undefined, codes: ReadonlySet<string>) =>
    code === undefined || codes.has(code);
  return (
    [
      ...(facts.workPeriods ?? []),
      ...(facts.jobOffers ?? []),
      ...(facts.registrations ?? []),
    ].every(({ occupation }) => named(occupation, occupations)) &&
    (facts.qualifications ?? []).every(({ field }) => named(field, studyFields))
  );
}

/** Whether every code an answer names is a known one, and every field it fills is one it asks. */
function knownCodes(input: QuestionInput, value: unknown, known: KnownCodes): boolean {
  const fieldKnown = (field: FieldInput, entry: unknown): boolean => {
    if (entry === undefined) return true;
    if (field.kind === 'language') return typeof entry === 'string' && languages.has(entry);
    if (field.kind === 'occupation') {
      return typeof entry === 'string' && known.occupations.has(entry);
    }
    if (field.kind === 'studyField') {
      return typeof entry === 'string' && known.studyFields.has(entry);
    }
    if (field.kind !== 'country') return true;
    return (
      typeof entry === 'string' &&
      (known.countries.has(entry) ||
        (field.formerStates === true && known.formerCountries.has(entry)))
    );
  };
  if (input.kind === 'list') {
    return (
      Array.isArray(value) &&
      value.every(
        (item) =>
          isRecord(item) &&
          input.fields.every(
            ({ key, input: field, onlyWhen }: QuestionField) =>
              fieldKnown(field, item[key]) &&
              (onlyWhen === undefined ||
                item[key] === undefined ||
                item[onlyWhen.key] === onlyWhen.value),
          ),
      )
    );
  }
  if (input.kind === 'country' || input.kind === 'language') return fieldKnown(input, value);
  return true;
}

export function relatedBy(
  personId: string,
  value: ProfileMarker,
  relationships: readonly RelationshipRow[],
): string[] {
  return relationships.flatMap(({ relationship: { kind, from, to } }) => {
    if (value === 'children') return kind === 'parent' && from === personId ? [to] : [];
    if (value === 'parents') return kind === 'parent' && to === personId ? [from] : [];
    const coupleKind = value === 'spouses' ? 'spouse' : 'partner';
    if (kind !== coupleKind) return [];
    return [from === personId ? to : from];
  });
}

export function answerOf(question: Question, state: QuestionState): unknown {
  const { target } = question;
  switch (target.kind) {
    case 'fact':
      // A qualification recorded before the status existed was a finished one.
      if (target.key === 'qualifications') {
        return state.facts.qualifications?.map((held) =>
          held.status === undefined ? { ...held, status: 'completed' } : held,
        );
      }
      return mapList(question.input, state.facts[target.key], moneyAnswer);
    case 'marker':
      return state.facts.recordedInFull?.includes(target.marker) === true ? true : undefined;
    case 'dependence':
      return state.dependsOn ?? undefined;
    case 'incomes':
      return mapList(question.input, state.finances?.incomes, moneyAnswer);
    case 'assetsMarker':
      return state.finances?.assetsRecordedInFull === true ? true : undefined;
    case 'assets':
      return state.assets.map(({ id, asset, share }) => ({
        id,
        ...asset,
        value: moneyAnswer(asset.value),
        share,
      }));
    case 'relationships':
      return state.relationships.map(({ id, relationship }) => ({
        id,
        kind: relationship.kind,
        from: relationship.from,
        to: relationship.to,
        ...relationship.details,
      }));
  }
}

export type AppliedAnswers =
  { readonly ok: true; readonly state: QuestionState } | { readonly ok: false };

/**
 * The person's state with these answers, or a refusal when an answer does not fit its question or
 * the storage schemas. `null` is "Não sei": the fact goes, so the engine reads it as unknown; for
 * assets and relationships, which save on their own rows, it changes nothing.
 */
export function applyAnswers(
  state: QuestionState,
  answers: readonly { readonly questionId: QuestionId; readonly answer: unknown }[],
  known: KnownCodes,
): AppliedAnswers {
  const refused = { ok: false } as const;
  const facts: Record<string, unknown> = { ...state.facts };
  const markers = new Set(state.facts.recordedInFull ?? []);
  let { dependsOn, finances, assets, relationships } = state;
  const byId = new Map<string, Question>(questionFlow.map((question) => [question.id, question]));
  if (new Set(answers.map(({ questionId }) => questionId)).size !== answers.length) return refused;

  for (const { questionId, answer } of answers) {
    const question = byId.get(questionId);
    if (question === undefined || answer === undefined) return refused;
    if (answer !== null && !knownCodes(question.input, answer, known)) return refused;
    const { target } = question;
    switch (target.kind) {
      case 'fact':
        facts[target.key] =
          answer === null ? undefined : mapList(question.input, answer, storedMoney);
        break;
      case 'marker':
        if (answer !== null && typeof answer !== 'boolean') return refused;
        if (answer === true) markers.add(target.marker);
        else markers.delete(target.marker);
        break;
      case 'dependence': {
        if (answer === null) {
          dependsOn = null;
          break;
        }
        const ids: unknown[] = Array.isArray(answer) ? answer : [];
        const people = ids.filter((id): id is string => typeof id === 'string');
        if (!Array.isArray(answer) || people.length !== ids.length) return refused;
        dependsOn = people;
        break;
      }
      case 'incomes': {
        const parsed = storedFinancesSchema.shape.incomes.safeParse(
          answer === null ? undefined : mapList(question.input, answer, storedMoney),
        );
        if (!parsed.success) return refused;
        finances = {
          ...(parsed.data === undefined ? {} : { incomes: parsed.data }),
          assetsRecordedInFull: finances?.assetsRecordedInFull ?? false,
        };
        break;
      }
      case 'assetsMarker':
        if (answer !== null && typeof answer !== 'boolean') return refused;
        finances = { ...finances, assetsRecordedInFull: answer === true };
        break;
      case 'assets': {
        if (answer === null) break;
        const held = heldAssets(answer, state.assets);
        if (held === undefined) return refused;
        assets = held;
        break;
      }
      case 'relationships': {
        if (answer === null) break;
        const edited = editedRelationships(answer, state.relationships);
        if (edited === undefined) return refused;
        relationships = edited;
        break;
      }
    }
  }

  facts['recordedInFull'] =
    markers.size > 0 ? profileMarkers.filter((value) => markers.has(value)) : undefined;
  // An unknown fact is absent, never a key holding nothing.
  const parsedFacts = storedProfileFactsSchema.safeParse(
    Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined)),
  );
  if (!parsedFacts.success) return refused;
  return {
    ok: true,
    state: { facts: parsedFacts.data, dependsOn, finances, assets, relationships },
  };
}

/**
 * The assets an answer lists: changed or kept ones by ID, new ones without one, and `{ id, dropped:
 * true }` for one the person no longer holds. An asset the answer does not name stays as it is, so
 * a form opened before another tab added an asset never drops it.
 */
function heldAssets(answer: unknown, current: readonly HeldAsset[]): HeldAsset[] | undefined {
  if (!Array.isArray(answer)) return undefined;
  const byId = new Map(current.flatMap((held) => (held.id === undefined ? [] : [[held.id, held]])));
  const named = new Set<string>();
  const dropped = new Set<string>();
  const added: HeldAsset[] = [];
  const edited = new Map<string, HeldAsset>();
  for (const item of answer) {
    if (!isRecord(item)) return undefined;
    const { id, share, dropped: drop, ...fields } = item;
    if (id !== undefined) {
      if (typeof id !== 'string' || !byId.has(id) || named.has(id)) return undefined;
      named.add(id);
    }
    if (drop !== undefined) {
      if (drop !== true || id === undefined || share !== undefined) return undefined;
      if (Object.keys(fields).length > 0) return undefined;
      dropped.add(id);
      continue;
    }
    const asset = storedAssetSchema.safeParse({ ...fields, value: storedMoney(fields['value']) });
    const parsedShare = storedOwnerShareSchema.safeParse(share);
    if (!asset.success || !parsedShare.success) return undefined;
    const held = { asset: asset.data, share: parsedShare.data };
    if (typeof id === 'string') edited.set(id, { id, ...held });
    else added.push(held);
  }
  return [
    ...current.flatMap((held) =>
      held.id === undefined || dropped.has(held.id) ? [] : [edited.get(held.id) ?? held],
    ),
    ...added,
  ];
}

export interface HeldAssetChanges {
  readonly dropped: readonly string[];
  readonly added: readonly HeldAsset[];
  readonly updated: readonly { readonly id: string; readonly asset: StoredAsset }[];
  readonly reshared: readonly { readonly id: string; readonly share: string }[];
}

const sameShare = (left: string, right: string) =>
  compareScaled(
    scaledDecimal(decimalSchema.parse(left)),
    scaledDecimal(decimalSchema.parse(right)),
  ) === 0;

/** What saving `after` over `before` writes: owner rows to drop, assets to add, fields and shares. */
export function heldAssetChanges(
  before: readonly HeldAsset[],
  after: readonly HeldAsset[],
): HeldAssetChanges {
  const kept = new Set(after.flatMap(({ id }) => (id === undefined ? [] : [id])));
  const previous = new Map(
    before.flatMap((held) => (held.id === undefined ? [] : [[held.id, held]])),
  );
  const updated: { id: string; asset: StoredAsset }[] = [];
  const reshared: { id: string; share: string }[] = [];
  for (const { id, asset, share } of after) {
    const current = id === undefined ? undefined : previous.get(id);
    if (id === undefined || current === undefined) continue;
    if (JSON.stringify(current.asset) !== JSON.stringify(asset)) updated.push({ id, asset });
    if (!sameShare(current.share, share)) reshared.push({ id, share });
  }
  return {
    dropped: [...previous.keys()].filter((id) => !kept.has(id)),
    added: after.filter(({ id }) => id === undefined),
    updated,
    reshared,
  };
}

/** Whether "Não sei" may answer the question: assets save on their own rows, so it would mean nothing. */
export const answerCanBeUnknown = (question: Question) => question.target.kind !== 'assets';

/** The person's relationships with the details an answer gives; their ends and kinds stay. */
function editedRelationships(
  answer: unknown,
  current: readonly RelationshipRow[],
): RelationshipRow[] | undefined {
  if (!Array.isArray(answer) || answer.length !== current.length) return undefined;
  const edited: RelationshipRow[] = [];
  for (const row of current) {
    const item: unknown = (answer as unknown[]).find(
      (entry) => isRecord(entry) && entry['id'] === row.id,
    );
    if (!isRecord(item)) return undefined;
    const { kind, from, to } = item;
    const details = Object.fromEntries(
      Object.entries(item).filter(([key]) => !['id', 'kind', 'from', 'to'].includes(key)),
    );
    const { relationship } = row;
    if (kind !== relationship.kind || from !== relationship.from || to !== relationship.to) {
      return undefined;
    }
    const parsed = storedRelationshipSchema.safeParse({ kind, from, to, details });
    if (!parsed.success) return undefined;
    edited.push({ id: row.id, relationship: parsed.data });
  }
  return edited;
}
