import { ageYears, type LeapDayBirthday } from '../calendar/age.js';
import { type CalendarDate, compareDates, firstDate, lastDate } from '../calendar/calendar-date.js';
import { type DateValue, dateRange } from '../calendar/partial-date.js';
import { type Interval, type Truth, and, or } from '../logic/truth.js';
import {
  type NumberValue,
  type TokenListValue,
  type Value,
  booleanValue,
  integerRange,
  tokenValue,
} from '../logic/value.js';
import type { CurrencyCode } from '../money/currency.js';
import type { Decimal } from '../money/decimal.js';
import { type CurrencyPair, type FxTable, convert } from '../money/fx.js';
import { type ExactAmount, type Money, addExact, multiplyExact, toExact } from '../money/money.js';
import {
  type IndexedSnapshot,
  after,
  couples,
  isRecordedInFull,
  onOrBefore,
  parents,
} from './graph.js';
import type { Person, Relationship } from './snapshot.js';

/** What every fact of one evaluation reads besides the person it is about. */
export interface FactEnvironment {
  readonly snapshot: IndexedSnapshot;
  readonly principalId: string;
  /** The route version's currency; money facts are converted to it. */
  readonly currency: CurrencyCode;
  readonly fx: FxTable;
  readonly leapDayBirthday?: LeapDayBirthday;
  /** The route version's country, for facts relative to it such as job offers. */
  readonly routeCountry: string;
  /** The unit, once computed: the people it includes and those it might. */
  readonly unit?: { readonly included: readonly string[]; readonly possible: readonly string[] };
}

/** A line from an ancestor down to the principal, and the position of the person in focus. */
export interface LineageBinding {
  readonly path: readonly string[];
  readonly position: number;
}

/** Who a fact is about: the person in focus, the edge a dependent was reached by, a lineage. */
export interface FactBinding {
  readonly environment: FactEnvironment;
  readonly personId: string;
  readonly edge?: Relationship;
  readonly lineage?: LineageBinding;
}

export interface Derived {
  readonly value: Value;
  readonly missingRates?: readonly CurrencyPair[];
}

export type FactScope = 'person' | 'unit' | 'edge' | 'lineage';

export type FactType =
  | { readonly kind: 'boolean' | 'integer' | 'money' | 'date' | 'country' | 'countries' }
  | { readonly kind: 'enum' | 'enum-list'; readonly values: readonly string[] };

export interface FactDefinition {
  readonly type: FactType;
  readonly scope: FactScope;
  /** Proven never negative, so an unbounded sum of it is unbounded above only. */
  readonly nonNegative?: boolean;
  /** Reads an age, so the route version must set `leapDayBirthday`. */
  readonly readsAge?: boolean;
  /** Reads a birth date as a date, which `since` must never take (spec 0002, R2). */
  readonly isBirthDate?: boolean;
  readonly derive: (binding: FactBinding, at: CalendarDate) => Derived;
}

const isicSections = 'ABCDEFGHIJKLMNOPQRSTU'.split('');
const parentKinds = ['biological', 'adoptive'] as const;
const custodies = ['full', 'shared', 'none'] as const;

/**
 * The closed catalog of facts rules can read (spec 0002, R3). Keys under `person.` read the person
 * in focus; an expression reaches the principal with `principal.` and, inside a line of
 * ancestors, the ancestor with `lineage.ancestor.`. Adding a fact is a reviewed code change.
 */
export const factCatalog = {
  'person.birthDate': {
    type: { kind: 'date' },
    scope: 'person',
    isBirthDate: true,
    derive: ({ environment, personId }) => dateFact(person(environment, personId).birthDate),
  },
  'person.ageYears': {
    type: { kind: 'integer' },
    scope: 'person',
    nonNegative: true,
    readsAge: true,
    derive: ({ environment, personId }, at) => ({
      value: ageRange(person(environment, personId).birthDate, at, environment.leapDayBirthday),
    }),
  },
  'person.citizenships': {
    type: { kind: 'countries' },
    scope: 'person',
    derive: ({ environment, personId }, at) => ({
      value: citizenshipsDuring(person(environment, personId), { min: at, max: at }),
    }),
  },
  'person.residenceCountry': {
    type: { kind: 'country' },
    scope: 'person',
    derive: ({ environment, personId }) => ({
      value: tokenValue(person(environment, personId).residenceCountry),
    }),
  },
  'person.educationLevel': {
    type: { kind: 'integer' },
    scope: 'person',
    nonNegative: true,
    derive: ({ environment, personId }) => {
      const level = person(environment, personId).educationLevel;
      return { value: level === undefined ? integerRange(0, 8) : integerRange(level, level) };
    },
  },
  'person.monthlyActiveIncome': {
    type: { kind: 'money' },
    scope: 'person',
    nonNegative: true,
    derive: (binding, at) => monthlyIncome(binding, at, 'active'),
  },
  'person.monthlyPassiveIncome': {
    type: { kind: 'money' },
    scope: 'person',
    nonNegative: true,
    derive: (binding, at) => monthlyIncome(binding, at, 'passive'),
  },
  'person.liquidAssets': {
    type: { kind: 'money' },
    scope: 'person',
    nonNegative: true,
    derive: ({ environment, personId }, at) => liquidAssets(environment, [personId], [], at),
  },
  'person.visaRefusals': {
    type: { kind: 'integer' },
    scope: 'person',
    nonNegative: true,
    derive: ({ environment, personId }, at) => ({
      value: visaRefusals(person(environment, personId), at),
    }),
  },
  'person.dependsOnPrincipal': {
    type: { kind: 'boolean' },
    scope: 'person',
    derive: ({ environment, personId }) => {
      const dependsOn = person(environment, personId).financiallyDependentOn;
      return {
        value: booleanValue(
          dependsOn === undefined ? 'unknown' : dependsOn.includes(environment.principalId),
        ),
      };
    },
  },
  'person.studying': {
    type: { kind: 'boolean' },
    scope: 'person',
    derive: ({ environment, personId }) => ({
      value: booleanValue(person(environment, personId).studying ?? 'unknown'),
    }),
  },
  'person.hasSpouse': {
    type: { kind: 'boolean' },
    scope: 'person',
    derive: ({ environment, personId }, at) => {
      const spouses = couples(environment.snapshot, personId, 'spouse', at);
      const any = or(spouses.map((spouse) => spouse.valid));
      const complete = isRecordedInFull(person(environment, personId), 'spouses');
      return { value: booleanValue(any === false && !complete ? 'unknown' : any) };
    },
  },
  'person.temporaryJobOfferSectors': {
    type: { kind: 'enum-list', values: isicSections },
    scope: 'person',
    derive: ({ environment, personId }) => {
      const offers = person(environment, personId).jobOffers;
      const sectors = (offers ?? [])
        .filter((offer) => offer.temporary && offer.country === environment.routeCountry)
        .map((offer) => offer.sector);
      return { value: tokens(sectors, [], offers !== undefined) };
    },
  },
  'unit.liquidAssets': {
    type: { kind: 'money' },
    scope: 'unit',
    nonNegative: true,
    derive: ({ environment }, at) => {
      const unit = environment.unit;
      if (unit === undefined) throw new RangeError('The unit is not computed yet');
      return liquidAssets(environment, unit.included, unit.possible, at);
    },
  },
  'edge.parentKind': {
    type: { kind: 'enum', values: parentKinds },
    scope: 'edge',
    derive: ({ edge }) => ({
      value: tokenValue(edge?.kind === 'parent' ? edge.parentKind : undefined),
    }),
  },
  'edge.custody': {
    type: { kind: 'enum', values: custodies },
    scope: 'edge',
    derive: ({ edge }) => ({
      value: tokenValue(edge?.kind === 'parent' ? edge.custody : undefined),
    }),
  },
  'edge.start': {
    type: { kind: 'date' },
    scope: 'edge',
    derive: ({ edge }) => dateFact(edge?.start),
  },
  'lineage.generation': {
    type: { kind: 'integer' },
    scope: 'lineage',
    nonNegative: true,
    derive: (binding) => {
      const { path, position } = lineageOf(binding);
      const generation = path.length - 1 - position;
      return { value: integerRange(generation, generation) };
    },
  },
  'lineage.edgeKind': {
    type: { kind: 'enum', values: parentKinds },
    scope: 'lineage',
    derive: (binding, at) => {
      const edge = edgeToNext(binding, at);
      return { value: tokenValue(edge?.kind === 'parent' ? edge.parentKind : undefined) };
    },
  },
  'lineage.childBirthDate': {
    type: { kind: 'date' },
    scope: 'lineage',
    isBirthDate: true,
    derive: (binding) => dateFact(person(binding.environment, nextInLine(binding)).birthDate),
  },
  'lineage.citizenshipsAtChildBirth': {
    type: { kind: 'countries' },
    scope: 'lineage',
    derive: (binding) => {
      const birth = person(binding.environment, nextInLine(binding)).birthDate;
      const during = birth === undefined ? { min: firstDate, max: lastDate } : dateRange(birth);
      return { value: citizenshipsDuring(person(binding.environment, binding.personId), during) };
    },
  },
} as const satisfies Record<string, FactDefinition>;

export type FactKey = keyof typeof factCatalog;

export function isFactKey(key: string): key is FactKey {
  return Object.hasOwn(factCatalog, key);
}

function person(environment: FactEnvironment, id: string): Person {
  return environment.snapshot.person(id);
}

function dateFact(value: DateValue | undefined): Derived {
  const range = value === undefined ? { min: firstDate, max: lastDate } : dateRange(value);
  return { value: { type: 'date', ...range } };
}

/**
 * Whole years at `at`. A partial birth date gives a range. Someone not yet born at `at` counts as
 * age zero, so a rule read at an earlier reference date still has an answer.
 */
function ageRange(
  birthDate: DateValue | undefined,
  at: CalendarDate,
  leapDayBirthday: LeapDayBirthday | undefined,
): NumberValue {
  if (birthDate === undefined) return integerRange(0, undefined);
  if (leapDayBirthday === undefined)
    throw new RangeError('The route version sets no leapDayBirthday');
  const { min, max } = dateRange(birthDate);
  const age = (birth: CalendarDate): number =>
    compareDates(birth, at) > 0 ? 0 : ageYears(birth, at, leapDayBirthday);
  return integerRange(age(max), age(min));
}

/** Citizenships held throughout an interval of dates: certainly, possibly, and whether complete. */
function citizenshipsDuring(subject: Person, during: Interval<CalendarDate>): TokenListValue {
  if (subject.citizenships === undefined) return tokens([], [], false);
  const held = subject.citizenships.map((citizenship) => {
    const acquired: Truth =
      citizenship.basis === 'birth'
        ? true
        : citizenship.acquired === undefined
          ? 'unknown'
          : onOrBefore(citizenship.acquired, during);
    const notLost: Truth =
      citizenship.lost === undefined
        ? 'unknown'
        : citizenship.lost === 'none'
          ? true
          : after(citizenship.lost, during);
    return { country: citizenship.country, held: and([acquired, notLost]) };
  });
  const definite = held.filter((entry) => entry.held === true).map((entry) => entry.country);
  const possible = held
    .filter((entry) => entry.held === 'unknown' && !definite.includes(entry.country))
    .map((entry) => entry.country);
  return tokens(definite, possible, true);
}

function tokens(
  definite: readonly string[],
  possible: readonly string[],
  complete: boolean,
): TokenListValue {
  return {
    type: 'tokens',
    definite: [...new Set(definite)].sort(),
    possible: [...new Set(possible)].sort(),
    complete,
  };
}

function visaRefusals(subject: Person, at: CalendarDate): NumberValue {
  const history = subject.immigrationHistory;
  if (history === undefined) return integerRange(0, undefined);
  const happened = history
    .filter((event) => event.kind === 'visa_refusal')
    .map((event) =>
      event.date === undefined ? 'unknown' : onOrBefore(event.date, { min: at, max: at }),
    );
  const certain = happened.filter((value) => value === true).length;
  const possible = happened.filter((value) => value === 'unknown').length;
  return integerRange(certain, certain + possible);
}

function monthlyIncome(
  { environment, personId }: FactBinding,
  at: CalendarDate,
  kind: 'active' | 'passive',
): Derived {
  const incomes = person(environment, personId).incomes;
  const sum = new MoneySum(environment, at);
  if (incomes === undefined) return sum.unbounded();
  for (const income of incomes.filter((entry) => entry.kind === kind)) {
    sum.add(toExact(income.monthly), true);
  }
  return sum.result();
}

/**
 * Liquid assets owned by some people, each counted at its owner's share, plus what possible
 * members might add. An asset counts when it is liquid and not sold by `at`; an unknown answer to
 * either makes its share possible instead of certain.
 */
function liquidAssets(
  environment: FactEnvironment,
  included: readonly string[],
  possible: readonly string[],
  at: CalendarDate,
): Derived {
  const sum = new MoneySum(environment, at);
  for (const asset of environment.snapshot.snapshot.assets) {
    const counted = and([
      asset.liquid ?? 'unknown',
      asset.sold === undefined
        ? 'unknown'
        : asset.sold === 'none'
          ? true
          : after(asset.sold, { min: at, max: at }),
    ]);
    for (const owner of asset.owners) {
      const membership: Truth = included.includes(owner.person)
        ? true
        : possible.includes(owner.person)
          ? 'unknown'
          : false;
      sum.add(share(asset.value, owner.share), and([counted, membership]));
    }
  }
  return sum.result();
}

function share(value: Money, ownerShare: Decimal): ExactAmount {
  return multiplyExact(toExact(value), ownerShare);
}

/** Sums non-negative amounts into the route's currency, as a range when some may not count. */
class MoneySum {
  private readonly environment: FactEnvironment;
  private readonly at: CalendarDate;
  private min: ExactAmount;
  private max: ExactAmount | undefined;
  private readonly missingRates: CurrencyPair[] = [];

  constructor(environment: FactEnvironment, at: CalendarDate) {
    this.environment = environment;
    this.at = at;
    this.min = { units: 0n, scale: 0, currency: environment.currency };
    this.max = this.min;
  }

  add(amount: ExactAmount, counts: Truth): void {
    if (counts === false) return;
    const converted = convert(amount, this.environment.currency, this.environment.fx, this.at);
    if (converted.kind === 'missing_rate') {
      if (!this.missingRates.some((pair) => pair.from === converted.pair.from)) {
        this.missingRates.push(converted.pair);
      }
      this.max = undefined;
      return;
    }
    if (counts === true) this.min = addExact(this.min, converted.amount);
    if (this.max !== undefined) this.max = addExact(this.max, converted.amount);
  }

  unbounded(): Derived {
    return { value: { type: 'number', currency: this.environment.currency, min: this.min } };
  }

  result(): Derived {
    const value: NumberValue = {
      type: 'number',
      currency: this.environment.currency,
      min: this.min,
      ...(this.max === undefined ? {} : { max: this.max }),
    };
    return this.missingRates.length === 0 ? { value } : { value, missingRates: this.missingRates };
  }
}

function lineageOf(binding: FactBinding): LineageBinding {
  if (binding.lineage === undefined) throw new RangeError('A lineage fact outside a line');
  return binding.lineage;
}

function nextInLine(binding: FactBinding): string {
  const { path, position } = lineageOf(binding);
  const next = path[position + 1];
  if (next === undefined) throw new RangeError('The principal has no next person in the line');
  return next;
}

function edgeToNext(binding: FactBinding, at: CalendarDate): Relationship | undefined {
  const next = nextInLine(binding);
  return parents(binding.environment.snapshot, next, at).find(
    (neighbor) => neighbor.id === binding.personId,
  )?.edge;
}
