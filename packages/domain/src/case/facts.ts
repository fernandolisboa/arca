import { type LeapDayBirthday, ageYears } from '../calendar/age.js';
import { type CalendarDate, compareDates, tryAddDays } from '../calendar/calendar-date.js';
import { type DateValue, after, dateRange, onOrBefore } from '../calendar/partial-date.js';
import { type Interval, type Truth, and, or } from '../logic/truth.js';
import {
  type NumberValue,
  type TokenListValue,
  type Value,
  booleanValue,
  integerRange,
  tokenValue,
  unknownDate,
} from '../logic/value.js';
import type { CurrencyCode } from '../money/currency.js';
import type { Decimal } from '../money/decimal.js';
import { type CurrencyPair, type FxTable, convert } from '../money/fx.js';
import { type ExactAmount, type Money, addExact, multiplyExact, toExact } from '../money/money.js';
import {
  type IndexedSnapshot,
  assertRecordedBy,
  couples,
  isRecordedInFull,
  parents,
} from './graph.js';
import {
  type CountryCode,
  type Person,
  type Relationship,
  custodies,
  isicSections,
  parentKinds,
} from './snapshot.js';

/** What every fact of one evaluation reads besides the person it is about. */
export interface FactEnvironment {
  readonly snapshot: IndexedSnapshot;
  readonly principalId: string;
  /** The route version's currency; money facts are converted to it. */
  readonly currency: CurrencyCode;
  readonly fx: FxTable;
  /** The date FX rates are taken at (spec 0002, R2), whatever date a fact is read at. */
  readonly factsAsOf: CalendarDate;
  readonly leapDayBirthday?: LeapDayBirthday;
  /** The route version's country, for facts relative to it such as job offers. */
  readonly routeCountry: CountryCode;
  /**
   * The unit, once computed: the people it includes (the principal among them), those it might,
   * and whether unrecorded people might belong to it.
   */
  readonly unit?: {
    readonly included: readonly string[];
    readonly possible: readonly string[];
    readonly open: boolean;
  };
}

/** A line from an ancestor (position 0) down to the principal, and the person in focus. */
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

/**
 * What a fact is about: a person (the principal, a candidate dependent, a member inside a
 * collection or an ancestor, depending on where the expression reads it), the unit, the edge a
 * candidate was reached by, or the line from an ancestor to the principal.
 */
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
    derive: (binding) => monthlyIncome(binding, 'active'),
  },
  'person.monthlyPassiveIncome': {
    type: { kind: 'money' },
    scope: 'person',
    nonNegative: true,
    derive: (binding) => monthlyIncome(binding, 'passive'),
  },
  'person.liquidAssets': {
    type: { kind: 'money' },
    scope: 'person',
    nonNegative: true,
    derive: ({ environment, personId }, at) =>
      liquidAssets(environment, { included: [personId], possible: [], open: false }, at),
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
    derive: ({ environment, personId }) => ({
      value: dependsOn(person(environment, personId), environment.principalId),
    }),
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
      if (environment.unit === undefined) throw new RangeError('The unit is not computed yet');
      return liquidAssets(environment, environment.unit, at);
    },
  },
  'edge.parentKind': {
    type: { kind: 'enum', values: parentKinds },
    scope: 'edge',
    derive: (binding) => {
      const edge = edgeOf(binding);
      return { value: tokenValue(edge.kind === 'parent' ? edge.parentKind : undefined) };
    },
  },
  'edge.custody': {
    type: { kind: 'enum', values: custodies },
    scope: 'edge',
    derive: (binding) => {
      const edge = edgeOf(binding);
      return { value: tokenValue(edge.kind === 'parent' ? edge.custody : undefined) };
    },
  },
  'edge.start': {
    type: { kind: 'date' },
    scope: 'edge',
    derive: (binding) => dateFact(edgeOf(binding).start),
  },
  /** The end of a couple edge; `"none"` means it had not ended by `recordedOn`, so it is later. */
  'edge.end': {
    type: { kind: 'date' },
    scope: 'edge',
    derive: (binding) => {
      const edge = edgeOf(binding);
      if (edge.kind === 'parent' || edge.end === undefined) return dateFact(undefined);
      if (edge.end !== 'none') return dateFact(edge.end);
      const unknown = unknownDate();
      const recordedOn = binding.environment.snapshot.snapshot.recordedOn;
      return { value: { ...unknown, min: tryAddDays(recordedOn, 1) ?? unknown.max } };
    },
  },
  /** Whether the candidate depends financially on the person they were reached from. */
  'edge.dependsOnLinkedPerson': {
    type: { kind: 'boolean' },
    scope: 'edge',
    derive: (binding) => {
      const linked = otherEnd(edgeOf(binding), binding.personId);
      return { value: dependsOn(person(binding.environment, binding.personId), linked) };
    },
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
      const during = birth === undefined ? unknownDate() : dateRange(birth);
      return { value: citizenshipsDuring(person(binding.environment, binding.personId), during) };
    },
  },
} as const satisfies Record<string, FactDefinition>;

export type FactKey = keyof typeof factCatalog;

export function isFactKey(key: string): key is FactKey {
  return Object.hasOwn(factCatalog, key);
}

/** Derives a fact, refusing a date after the one the snapshot describes. */
export function deriveFact(key: FactKey, binding: FactBinding, at: CalendarDate): Derived {
  assertRecordedBy(binding.environment.snapshot, at);
  assertRecordedBy(binding.environment.snapshot, binding.environment.factsAsOf);
  return factCatalog[key].derive(binding, at);
}

function person(environment: FactEnvironment, id: string): Person {
  return environment.snapshot.person(id);
}

function dateFact(value: DateValue | undefined): Derived {
  return { value: value === undefined ? unknownDate() : { type: 'date', ...dateRange(value) } };
}

function dependsOn(subject: Person, on: string): Value {
  const list = subject.financiallyDependentOn;
  return booleanValue(list === undefined ? 'unknown' : list.includes(on));
}

/**
 * Whole years at `at`. A partial birth date gives a range. Someone born after `at` counts as age
 * zero; edges to them are not valid before their birth, so they are reached only through an
 * explicit adoption date.
 */
function ageRange(
  birthDate: DateValue | undefined,
  at: CalendarDate,
  leapDayBirthday: LeapDayBirthday | undefined,
): NumberValue {
  if (leapDayBirthday === undefined) {
    throw new RangeError('The route version sets no leapDayBirthday');
  }
  if (birthDate === undefined) return integerRange(0, undefined);
  const { min, max } = dateRange(birthDate);
  const age = (birth: CalendarDate): number =>
    compareDates(birth, at) > 0 ? 0 : ageYears(birth, at, leapDayBirthday);
  return integerRange(age(max), age(min));
}

/**
 * Citizenships held throughout an interval of dates: certainly, possibly, and whether the list is
 * complete. A citizenship by birth is held from the holder's birth.
 */
function citizenshipsDuring(subject: Person, during: Interval<CalendarDate>): TokenListValue {
  if (subject.citizenships === undefined) return tokens([], [], false);
  const held = subject.citizenships.map((citizenship) => {
    const since =
      citizenship.acquired ?? (citizenship.basis === 'birth' ? subject.birthDate : undefined);
    const acquired: Truth =
      since === undefined
        ? citizenship.basis === 'birth'
          ? true
          : 'unknown'
        : onOrBefore(since, during);
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
  kind: 'active' | 'passive',
): Derived {
  const incomes = person(environment, personId).incomes;
  const sum = new MoneySum(environment);
  if (incomes === undefined) sum.open();
  for (const income of (incomes ?? []).filter((entry) => entry.kind === kind)) {
    sum.add(toExact(income.monthly), true);
  }
  return sum.result();
}

/**
 * Liquid assets owned by the unit's people, each counted at its owner's share. An asset counts
 * when it is liquid and not sold by `at`; an unknown answer, or an owner who is only possibly in
 * the unit, makes its share possible instead of certain. Anyone whose assets are not recorded in
 * full, or unrecorded people in an open unit, leave the total unbounded above.
 */
function liquidAssets(
  environment: FactEnvironment,
  unit: NonNullable<FactEnvironment['unit']>,
  at: CalendarDate,
): Derived {
  const sum = new MoneySum(environment);
  const people = [...unit.included, ...unit.possible];
  if (unit.open || people.some((id) => !isRecordedInFull(person(environment, id), 'assets'))) {
    sum.open();
  }
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
      const membership: Truth = unit.included.includes(owner.person)
        ? true
        : unit.possible.includes(owner.person)
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

/**
 * Sums non-negative amounts into the route's currency as an interval: certain amounts raise both
 * bounds, possible ones only the upper. Totals per source currency are converted once each, at
 * `factsAsOf`; a missing rate leaves the upper bound open and is reported.
 */
class MoneySum {
  private readonly environment: FactEnvironment;
  private readonly certain = new Map<CurrencyCode, ExactAmount>();
  private readonly possible = new Map<CurrencyCode, ExactAmount>();
  private unbounded = false;

  constructor(environment: FactEnvironment) {
    this.environment = environment;
  }

  open(): void {
    this.unbounded = true;
  }

  add(amount: ExactAmount, counts: Truth): void {
    if (counts === false) return;
    const target = counts === true ? this.certain : this.possible;
    const previous = target.get(amount.currency);
    target.set(amount.currency, previous === undefined ? amount : addExact(previous, amount));
  }

  result(): Derived {
    const missingRates: CurrencyPair[] = [];
    const total = (
      amounts: Map<CurrencyCode, ExactAmount>,
    ): { sum: ExactAmount; complete: boolean } => {
      let sum: ExactAmount = { units: 0n, scale: 0, currency: this.environment.currency };
      let complete = true;
      for (const amount of amounts.values()) {
        const converted = convert(
          amount,
          this.environment.currency,
          this.environment.fx,
          this.environment.factsAsOf,
        );
        if (converted.kind === 'missing_rate') {
          if (!missingRates.some((pair) => pair.from === converted.pair.from)) {
            missingRates.push(converted.pair);
          }
          complete = false;
        } else {
          sum = addExact(sum, converted.amount);
        }
      }
      return { sum, complete };
    };
    const certain = total(this.certain);
    const possible = total(this.possible);
    // Amounts are never negative, so what converted is a lower bound even when a rate is missing.
    const min = certain.sum;
    const max =
      this.unbounded || !certain.complete || !possible.complete
        ? undefined
        : addExact(certain.sum, possible.sum);
    const value: NumberValue = {
      type: 'number',
      currency: this.environment.currency,
      min,
      ...(max === undefined ? {} : { max }),
    };
    return missingRates.length === 0 ? { value } : { value, missingRates };
  }
}

function edgeOf(binding: FactBinding): Relationship {
  if (binding.edge === undefined) throw new RangeError('An edge fact outside a dependent rule');
  return binding.edge;
}

function otherEnd(edge: Relationship, id: string): string {
  if (edge.kind === 'parent') return edge.parent === id ? edge.child : edge.parent;
  return edge.people[0] === id ? edge.people[1] : edge.people[0];
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
